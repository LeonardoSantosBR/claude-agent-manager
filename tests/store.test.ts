import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STATE_FILE } from '../server/config.ts'
import { flushState, loadState, saveState } from '../server/store.ts'
import type { SessionMeta } from '../shared/types.ts'

const DIR = dirname(STATE_FILE)

function writeState(content: string) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(STATE_FILE, content)
}

/**
 * Only the state file, never the whole dir: scrollback.test.ts runs in a
 * parallel worker against the same STATE_DIR, and wiping it from under that
 * one makes both files flaky.
 */
function clearState() {
  rmSync(STATE_FILE, { force: true })
}

const session = (patch: Partial<SessionMeta> = {}): SessionMeta => ({
  id: 'a1',
  name: 'demo',
  cwd: '/tmp/demo',
  project: 'demo',
  groupId: null,
  status: 'running',
  createdAt: 1,
  lastActivityAt: 2,
  exitCode: null,
  resumed: false,
  ...patch,
})

afterEach(() => {
  flushState() // drain the debounce so it can't fire into the next test
  clearState()
})

describe('loadState', () => {
  it('starts empty when nothing was ever saved', () => {
    clearState()
    expect(loadState()).toEqual({ sessions: [], groups: [] })
  })

  it('survives a corrupt file instead of taking the server down', () => {
    writeState('{ not json')
    expect(loadState()).toEqual({ sessions: [], groups: [] })
  })

  it('reads the legacy format, where the file was just the sessions array', () => {
    writeState(JSON.stringify([session()]))
    const state = loadState()
    expect(state.groups).toEqual([])
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0].id).toBe('a1')
  })

  it('brings every session back stopped — the PTYs died with the server', () => {
    writeState(JSON.stringify({ sessions: [session({ status: 'running', exitCode: 3 })], groups: [] }))
    const [restored] = loadState().sessions
    expect(restored.status).toBe('stopped')
    expect(restored.exitCode).toBe(null)
  })

  it('defaults a missing groupId to null rather than undefined', () => {
    const legacy: Partial<SessionMeta> = session()
    delete legacy.groupId
    writeState(JSON.stringify({ sessions: [legacy], groups: [] }))
    expect(loadState().sessions[0].groupId).toBe(null)
  })
})

describe('saveState', () => {
  it('debounces, and flushState writes the last value synchronously', () => {
    saveState({ sessions: [session({ name: 'first' })], groups: [] })
    saveState({ sessions: [session({ name: 'second' })], groups: [] })
    flushState()
    expect(loadState().sessions[0].name).toBe('second')
  })

  it('writes a readable file from scratch', () => {
    clearState()
    saveState({ sessions: [], groups: [] })
    flushState()
    expect(loadState()).toEqual({ sessions: [], groups: [] })
  })
})
