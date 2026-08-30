import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
}

/** Claude reads files without prompting inside the session's own folder, so
 *  pastes land there rather than in the OS temp dir. */
const IMAGE_DIR = join('.claude', 'images')

/** Only files this module wrote are ever deleted. */
const PREFIX = 'paste-'
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_FILES = 50

export class ImageError extends Error {}

/**
 * Drops old pastes. A session keeps referring to a path only while the message
 * is being composed, so anything past a day is dead weight; the count cap
 * covers a burst of pastes inside that window.
 */
function prune(dir: string) {
  let entries: { path: string; time: number }[]
  try {
    entries = readdirSync(dir)
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => {
        const path = join(dir, name)
        return { path, time: statSync(path).mtimeMs }
      })
  } catch {
    return // unreadable dir is not worth failing an upload over
  }

  const cutoff = Date.now() - MAX_AGE_MS
  entries.sort((a, b) => b.time - a.time) // newest first
  for (const [index, entry] of entries.entries()) {
    if (index < MAX_FILES && entry.time >= cutoff) continue
    try {
      rmSync(entry.path)
    } catch {
      /* already gone, or held open — the next paste retries */
    }
  }
}

/**
 * Writes a pasted/dropped image next to the session's project and returns the
 * absolute path to hand to the PTY.
 */
export function saveImage(cwd: string, mime: string, base64: string): string {
  const extension = EXTENSIONS[mime]
  if (!extension) throw new ImageError(`unsupported image type: ${mime}`)

  const data = Buffer.from(base64, 'base64')
  if (data.length === 0) throw new ImageError('empty image')

  const dir = join(cwd, IMAGE_DIR)
  mkdirSync(dir, { recursive: true })

  prune(dir)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `paste-${stamp}.${extension}`)
  writeFileSync(path, data)
  return path
}
