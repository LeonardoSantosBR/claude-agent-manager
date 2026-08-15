import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.ts'

/**
 * Terminal output kept on disk, so a session's screen survives a server
 * restart. The conversation itself is Claude's (in its own history) — what we
 * persist here is only what was *rendered*, ANSI and all, so reopening a stopped
 * session shows the last screen instead of a blank pane.
 */

const DIR = join(STATE_DIR, 'scrollback')
/** Same cap as the in-memory ring, so disk never holds more than the replay. */
const LIMIT = 512 * 1024
/** Writing on every chunk would hammer the disk during heavy output. */
const THROTTLE_MS = 2500

const pending = new Map<string, string>()
let timer: NodeJS.Timeout | null = null

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

function fileFor(id: string) {
  return join(DIR, `${id}.ansi`)
}

export function readScrollback(id: string): string {
  try {
    return readFileSync(fileFor(id), 'utf8')
  } catch {
    return '' // never written, or wiped
  }
}

function flushPending() {
  timer = null
  if (pending.size === 0) return
  ensureDir()
  for (const [id, buffer] of pending) {
    try {
      writeFileSync(fileFor(id), buffer.slice(-LIMIT))
    } catch {
      /* disk full / permissions — losing scrollback must not kill a session */
    }
  }
  pending.clear()
}

/** Queues a write; the trailing throttle collapses bursts into one write. */
export function saveScrollback(id: string, buffer: string) {
  pending.set(id, buffer)
  if (!timer) timer = setTimeout(flushPending, THROTTLE_MS)
}

/** Synchronous flush for shutdown — Ctrl+C must not drop the last screen. */
export function flushScrollback() {
  if (timer) clearTimeout(timer)
  flushPending()
}

export function dropScrollback(id: string) {
  pending.delete(id)
  try {
    rmSync(fileFor(id), { force: true })
  } catch {
    /* already gone */
  }
}
