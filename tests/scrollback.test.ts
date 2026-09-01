import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STATE_DIR } from '../server/config.ts'
import {
  dropScrollback,
  flushScrollback,
  readScrollback,
  saveScrollback,
} from '../server/scrollback.ts'

// Only our own subdir: store.test.ts runs in a parallel worker against the
// same STATE_DIR.
const DIR = join(STATE_DIR, 'scrollback')

afterEach(() => {
  flushScrollback()
  rmSync(DIR, { recursive: true, force: true })
})

describe('scrollback', () => {
  it('reads back what was flushed', () => {
    saveScrollback('a1', 'hello \x1b[31mworld\x1b[0m')
    flushScrollback()
    expect(readScrollback('a1')).toBe('hello \x1b[31mworld\x1b[0m')
  })

  it('is empty for a session that never wrote one', () => {
    expect(readScrollback('never')).toBe('')
  })

  it('collapses a burst into a single write of the last screen', () => {
    saveScrollback('a1', 'first')
    saveScrollback('a1', 'second')
    saveScrollback('a1', 'third')
    flushScrollback()
    expect(readScrollback('a1')).toBe('third')
  })

  it('keeps sessions apart', () => {
    saveScrollback('a1', 'one')
    saveScrollback('b2', 'two')
    flushScrollback()
    expect(readScrollback('a1')).toBe('one')
    expect(readScrollback('b2')).toBe('two')
  })

  it('caps the file at the replay size, keeping the tail', () => {
    const limit = 512 * 1024
    saveScrollback('a1', 'x'.repeat(limit + 1000) + 'END')
    flushScrollback()
    const stored = readScrollback('a1')
    expect(stored.length).toBe(limit)
    expect(stored.endsWith('END')).toBe(true)
  })

  it('drops the file and any write still queued for it', () => {
    saveScrollback('a1', 'hello')
    flushScrollback()
    saveScrollback('a1', 'queued but doomed')
    dropScrollback('a1')
    flushScrollback()
    expect(readScrollback('a1')).toBe('')
  })
})
