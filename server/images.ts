import { mkdirSync, writeFileSync } from 'node:fs'
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

export class ImageError extends Error {}

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

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `paste-${stamp}.${extension}`)
  writeFileSync(path, data)
  return path
}
