// Pure helpers for the Animation widget: picking the piece from .env, the
// files a piece needs, and turning a frame into Raster cells.

export const DEFAULT_ANIMATION_URL = 'https://www.ascii-magic.com/ascii/cpu-cores'
export const ASCII_BASE = 'https://www.ascii-magic.com/ascii/'

/** KEY=value lines of a .env file (quotes stripped, comments skipped). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let v = m[2]!.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '')
    out[m[1]!] = v
  }
  return out
}

/** The piece slug of an ascii-magic.com piece page, or null for anything else. */
export function slugFromUrl(url: string): string | null {
  const m = /^https:\/\/(?:www\.)?ascii-magic\.com\/ascii\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/.exec(url.trim())
  return m ? m[1]! : null
}

/** Relative imports of a module's source (`from "../lib/kit.js"`). */
export function relativeImports(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) out.add(m[1]!)
  return [...out]
}

/**
 * Resolves `spec` against the module at `from` (both relative to the
 * library root, e.g. "pieces/x.js"); null if it leaves the root or isn't a
 * plain .js path.
 */
export function resolveImport(from: string, spec: string): string | null {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  const path = parts.join('/')
  return /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.js$/i.test(path) ? path : null
}

// ---------- Frames to cells ----------

const DEFAULT_COLOR = 0x01000000

export function hexColor(hex: string | undefined): number | undefined {
  if (!hex) return undefined
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  return m ? parseInt(m[1]!, 16) : undefined
}

/** A character the Raster takes (printable, one cell wide), else a stand-in. */
function safeCodePoint(ch: string | undefined): number {
  const cp = ch ? ch.codePointAt(0)! : 0x20
  if (cp >= 0x20 && cp <= 0x7e) return cp
  if (cp >= 0xa1 && cp <= 0x2ff) return cp // Latin-1 and Latin extended
  if (cp >= 0x370 && cp <= 0x52f) return cp // Greek, Cyrillic
  if (cp >= 0x2010 && cp <= 0x205e) return cp // punctuation
  if (cp >= 0x2070 && cp <= 0x23ff) return cp // super/subscripts, currency, arrows, math, technical
  if (cp >= 0x2500 && cp <= 0x25ff) return cp // box drawing, blocks, geometric shapes
  if (cp >= 0x2800 && cp <= 0x28ff) return cp // braille
  return cp === 0xa0 ? 0x20 : 0x2a // '*' for anything that may be wide or zero-width
}

export type Frame = { text: string; color?: string }

/** A row holding words (letters or digits), drawn word by word so none lose letters. */
const isTextRow = (chars: string[]) => chars.some(c => /[A-Za-z0-9]/.test(c))

/**
 * For each of `w` output columns, the source column it shows (-1 for blank).
 * Picture rows are sampled to the nearest cell; text rows keep every word
 * whole, each placed near its scaled position, squeezed together if needed.
 */
function columnMap(chars: string[], sc: number, w: number): number[] {
  const map = new Array<number>(w).fill(-1)
  if (!isTextRow(chars)) {
    for (let x = 0; x < w; x++) map[x] = Math.min(sc - 1, Math.floor(((x + 0.5) * sc) / w))
    return map
  }
  const words: { from: number; len: number; at: number }[] = []
  for (let i = 0; i < chars.length; ) {
    if (chars[i] === ' ' || chars[i] === undefined) { i++; continue }
    let j = i
    while (j < chars.length && chars[j] !== ' ') j++
    words.push({ from: i, len: j - i, at: Math.round((i * w) / sc) })
    i = j
  }
  // Left to right: no overlaps, one space between words. Right to left: fit the width.
  for (let k = 1; k < words.length; k++) words[k]!.at = Math.max(words[k]!.at, words[k - 1]!.at + words[k - 1]!.len + 1)
  let limit = w
  for (let k = words.length - 1; k >= 0; k--) {
    const wd = words[k]!
    wd.at = Math.max(0, Math.min(wd.at, limit - wd.len))
    limit = wd.at - 1
  }
  for (const wd of words) for (let c = 0; c < wd.len; c++) if (wd.at + c >= 0 && wd.at + c < w) map[wd.at + c] = wd.from + c
  return map
}

/**
 * Lays a frame into a `cols` x `rows` box, scaled up or down to fill it
 * with its aspect kept, and centred along the side with room left. The
 * first and last rows are always kept (where pieces put their labels).
 * Returns u32 triplets [codePoint, fg, bg] per cell, row-major.
 */
export function frameToWords(
  frame: Frame,
  cols: number,
  rows: number,
  palette: Record<string, string>,
  ink: number | undefined,
  background: number | undefined,
): Uint32Array {
  const lines = frame.text.split('\n')
  const colors = frame.color ? frame.color.split('\n') : []
  const sr = Math.max(1, lines.length)
  const sc = Math.max(1, ...lines.map(l => [...l].length))
  const s = Math.min(cols / sc, rows / sr)
  const w = Math.max(1, Math.min(cols, Math.round(sc * s)))
  const h = Math.max(1, Math.min(rows, Math.round(sr * s)))
  const ox = Math.floor((cols - w) / 2)
  const oy = Math.floor((rows - h) / 2)
  const bg = background ?? DEFAULT_COLOR
  const fg = ink ?? DEFAULT_COLOR
  const pal: Record<string, number> = {}
  for (const [k, v] of Object.entries(palette)) {
    const c = hexColor(v)
    if (c !== undefined) pal[k] = c
  }
  const srcChars = lines.map(l => [...l])
  const srcCols = colors.map(l => [...l])
  const maps = new Map<number, number[]>()

  const words = new Uint32Array(cols * rows * 3)
  let prevSy = -1
  for (let y = 0; y < rows; y++) {
    const ty = y - oy
    let sy = -1
    if (ty >= 0 && ty < h) {
      sy = h === 1 ? 0 : Math.round((ty * (sr - 1)) / (h - 1))
      // Scaled up, a row repeats: a picture row may, a line of text may not.
      if (sy === prevSy && isTextRow(srcChars[sy] ?? [])) sy = -2
      else prevSy = sy
    }
    let map: number[] | undefined
    if (sy >= 0) {
      map = maps.get(sy)
      if (!map) maps.set(sy, (map = columnMap(srcChars[sy] ?? [], sc, w)))
    }
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 3
      let cp = 0x20
      let color = fg
      const tx = x - ox
      const sx = map && tx >= 0 && tx < w ? map[tx]! : -1
      if (sx >= 0) {
        cp = safeCodePoint(srcChars[sy]?.[sx])
        const key = srcCols[sy]?.[sx]
        if (key && key !== ' ' && pal[key] !== undefined) color = pal[key]!
      }
      words[i] = cp
      words[i + 1] = color
      words[i + 2] = bg
    }
  }
  return words
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of the words' little-endian bytes. */
export function wordsToBase64(words: Uint32Array): string {
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength)
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i]! << 16
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '=='
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '='
  }
  return out
}

/** A blank box (for before the first frame). */
export function blankCells(cols: number, rows: number, ink: number | undefined, background: number | undefined): string {
  return wordsToBase64(frameToWords({ text: '' }, cols, rows, {}, ink, background))
}
