import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasSessionHistory, listHistory } from '../server/history.ts'

const CONFIG = join(tmpdir(), 'claude-agent-manager-tests', 'config')
const PROJECTS = join(CONFIG, 'projects')

/** One .jsonl the way Claude Code writes it: one JSON record per line. */
function transcript(slug: string, id: string, records: unknown[]) {
  mkdirSync(join(PROJECTS, slug), { recursive: true })
  writeFileSync(
    join(PROJECTS, slug, `${id}.jsonl`),
    records.map((record) => JSON.stringify(record)).join('\n'),
  )
}

const user = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  cwd: '/home/me/proj',
  message: { content: [{ type: 'text', text }] },
  ...extra,
})

beforeEach(() => {
  rmSync(CONFIG, { recursive: true, force: true })
  mkdirSync(PROJECTS, { recursive: true })
})

afterEach(() => {
  rmSync(CONFIG, { recursive: true, force: true })
})

describe('hasSessionHistory', () => {
  it('finds the transcript whatever project dir it landed in', () => {
    transcript('-home-me-proj', 'aaa', [user('hi')])
    expect(hasSessionHistory(CONFIG, 'aaa')).toBe(true)
  })

  it('is false for a session that never exchanged a message', () => {
    // This is the case that makes `claude --resume` exit with "No conversation
    // found" — spawn() falls back to a fresh session under the same id.
    expect(hasSessionHistory(CONFIG, 'never-spoke')).toBe(false)
  })

  it('is false when no claude ever ran here', () => {
    rmSync(CONFIG, { recursive: true, force: true })
    expect(hasSessionHistory(CONFIG, 'aaa')).toBe(false)
  })
})

describe('listHistory', () => {
  it('returns nothing when there are no projects', async () => {
    rmSync(CONFIG, { recursive: true, force: true })
    expect(await listHistory(CONFIG, new Set())).toEqual([])
  })

  it('reports the cwd, the project name and the first human message', async () => {
    transcript('-home-me-proj', 'aaa', [user('fix the login bug')])
    const [entry] = await listHistory(CONFIG, new Set())
    expect(entry).toMatchObject({
      id: 'aaa',
      cwd: '/home/me/proj',
      project: 'proj',
      preview: 'fix the login bug',
      open: false,
    })
  })

  it('skips system-reminders, caveats and sidechains when picking the preview', async () => {
    transcript('-home-me-proj', 'aaa', [
      user('<system-reminder>ignore me</system-reminder>'),
      user('Caveat: local command output'),
      user('sidechain chatter', { isSidechain: true }),
      { type: 'assistant', cwd: '/home/me/proj', message: { content: 'not a human' } },
      user('the real first message'),
    ])
    const [entry] = await listHistory(CONFIG, new Set())
    expect(entry.preview).toBe('the real first message')
  })

  it('collapses whitespace and caps the preview', async () => {
    transcript('-home-me-proj', 'aaa', [user(`a\n\n  b ${'x'.repeat(300)}`)])
    const [entry] = await listHistory(CONFIG, new Set())
    expect(entry.preview.length).toBe(140)
    expect(entry.preview.startsWith('a b x')).toBe(true)
  })

  it('marks the sessions that are already open in the manager', async () => {
    transcript('-home-me-proj', 'aaa', [user('hi')])
    const [entry] = await listHistory(CONFIG, new Set(['aaa']))
    expect(entry.open).toBe(true)
  })

  it('drops a transcript with no cwd — there is nowhere to resume it', async () => {
    transcript('-home-me-proj', 'aaa', [{ type: 'user', message: { content: 'hi' } }])
    expect(await listHistory(CONFIG, new Set())).toEqual([])
  })

  it('ignores empty files and non-jsonl entries', async () => {
    mkdirSync(join(PROJECTS, '-home-me-proj'), { recursive: true })
    writeFileSync(join(PROJECTS, '-home-me-proj', 'empty.jsonl'), '')
    writeFileSync(join(PROJECTS, '-home-me-proj', 'notes.txt'), 'hello')
    expect(await listHistory(CONFIG, new Set())).toEqual([])
  })

  it('sorts most recently touched first', async () => {
    transcript('-home-me-proj', 'older', [user('one')])
    await new Promise((resolve) => setTimeout(resolve, 20))
    transcript('-home-me-other', 'newer', [user('two')])
    const ids = (await listHistory(CONFIG, new Set())).map((entry) => entry.id)
    expect(ids).toEqual(['newer', 'older'])
  })
})
