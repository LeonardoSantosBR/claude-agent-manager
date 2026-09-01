import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
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

/** Latest screen per session, waiting for the next flush. */
const pending = new Map<string, string>()
/** Sessions with a write already in the air — see flushPending(). */
const inFlight = new Set<string>()
/**
 * Sessions deleted while a write was in flight. The write can't be cancelled,
 * so it re-deletes the file it just recreated.
 */
const dropped = new Set<string>()
let timer: NodeJS.Timeout | null = null
/** What the shutdown flush put on disk, so a late write can't undo it. */
const finalScreens = new Map<string, string>()

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

/**
 * Off the event loop, deliberately: this runs every few seconds per busy
 * session and each write is up to 512KB — done synchronously it stalls every
 * other session's output while the disk works.
 */
async function writeOne(id: string, buffer: string) {
  inFlight.add(id)
  try {
    await writeFile(fileFor(id), buffer.slice(-LIMIT))
  } catch {
    /* disk full / permissions — losing scrollback must not kill a session */
  } finally {
    inFlight.delete(id)
    if (dropped.has(id)) {
      dropped.delete(id)
      rmSync(fileFor(id), { force: true })
    } else if (finalScreens.has(id)) {
      const screen = finalScreens.get(id)!
      finalScreens.delete(id)
      // The shutdown flush wrote the last screen while this one was in the air.
      // Landing second, it would leave a stale frame on disk — put the real one
      // back, synchronously, in case the process dies right after.
      try {
        writeFileSync(fileFor(id), screen)
      } catch {
        /* nothing left to do this late */
      }
    }
  }
}

function flushPending() {
  timer = null
  if (pending.size === 0) return
  ensureDir()
  for (const [id, buffer] of [...pending]) {
    // Two writes racing to the same file can land out of order, leaving the
    // older screen on disk. The buffer stays queued and the retry below picks
    // it up — by then it's the newest one anyway.
    if (inFlight.has(id)) continue
    pending.delete(id)
    void writeOne(id, buffer)
  }
  if (pending.size > 0 && !timer) timer = setTimeout(flushPending, THROTTLE_MS)
}

/** Queues a write; the trailing throttle collapses bursts into one write. */
export function saveScrollback(id: string, buffer: string) {
  dropped.delete(id)
  finalScreens.delete(id) // the session is alive again; that frame isn't final
  pending.set(id, buffer)
  if (!timer) timer = setTimeout(flushPending, THROTTLE_MS)
}

/**
 * Synchronous flush for shutdown and for a session that just exited — Ctrl+C
 * must not drop the last screen, and process.exit() won't wait for a promise.
 */
export function flushScrollback() {
  if (timer) clearTimeout(timer)
  timer = null
  if (pending.size === 0) return
  ensureDir()
  for (const [id, buffer] of pending) {
    const screen = buffer.slice(-LIMIT)
    try {
      writeFileSync(fileFor(id), screen)
      // Only worth remembering while an async write could still land on top.
      if (inFlight.has(id)) finalScreens.set(id, screen)
    } catch {
      /* nothing left to do this late */
    }
  }
  pending.clear()
}

export function dropScrollback(id: string) {
  pending.delete(id)
  finalScreens.delete(id)
  if (inFlight.has(id)) dropped.add(id) // the write in flight deletes it again
  try {
    rmSync(fileFor(id), { force: true })
  } catch {
    /* already gone */
  }
}
