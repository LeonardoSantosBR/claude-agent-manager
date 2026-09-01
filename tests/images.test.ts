import { mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ImageError, saveImage } from '../server/images.ts'

const CWD = join(tmpdir(), 'claude-agent-manager-tests', 'images-cwd')
const DIR = join(CWD, '.claude', 'images')
const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')

/** A rejected upload never creates the folder, so a missing dir means zero. */
function pastes(): string[] {
  try {
    return readdirSync(DIR).filter((name) => name.startsWith('paste-'))
  } catch {
    return []
  }
}

/** Backdates a file so prune() sees it as older than the 24h cutoff. */
function age(name: string, days: number) {
  const when = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  utimesSync(join(DIR, name), when, when)
}

beforeEach(() => {
  rmSync(CWD, { recursive: true, force: true })
  mkdirSync(CWD, { recursive: true })
})

afterEach(() => {
  rmSync(CWD, { recursive: true, force: true })
})

describe('saveImage', () => {
  it('writes into the session folder, where Claude can read it unprompted', () => {
    const path = saveImage(CWD, 'image/png', PNG)
    expect(path.startsWith(DIR)).toBe(true)
    expect(basename(path)).toMatch(/^paste-.*\.png$/)
    expect(pastes()).toHaveLength(1)
  })

  it('maps every accepted mime to its extension', () => {
    expect(saveImage(CWD, 'image/jpeg', PNG)).toMatch(/\.jpg$/)
    expect(saveImage(CWD, 'image/webp', PNG)).toMatch(/\.webp$/)
    expect(saveImage(CWD, 'image/svg+xml', PNG)).toMatch(/\.svg$/)
  })

  it('refuses anything that is not an image we named', () => {
    // The mime is the only thing standing between a paste and an arbitrary
    // file written into the user's project.
    expect(() => saveImage(CWD, 'application/pdf', PNG)).toThrow(ImageError)
    expect(() => saveImage(CWD, 'text/html', PNG)).toThrow(ImageError)
    expect(() => saveImage(CWD, '', PNG)).toThrow(ImageError)
    expect(pastes()).toHaveLength(0)
  })

  it('refuses an empty body', () => {
    expect(() => saveImage(CWD, 'image/png', '')).toThrow(ImageError)
  })
})

describe('prune', () => {
  it('keeps at most 50 pastes, dropping the oldest', () => {
    mkdirSync(DIR, { recursive: true })
    for (let i = 0; i < 60; i++) {
      const name = `paste-old-${i}.png`
      writeFileSync(join(DIR, name), 'x')
      // Distinct mtimes, all inside the age window, oldest = highest index.
      const when = new Date(Date.now() - (i + 1) * 1000)
      utimesSync(join(DIR, name), when, when)
    }
    saveImage(CWD, 'image/png', PNG)
    // The 50 kept, plus the one just written.
    expect(pastes()).toHaveLength(51)
    expect(pastes()).not.toContain('paste-old-59.png')
    expect(pastes()).toContain('paste-old-0.png')
  })

  it('drops pastes older than a day even when well under the count cap', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'paste-stale.png'), 'x')
    age('paste-stale.png', 2)
    saveImage(CWD, 'image/png', PNG)
    expect(pastes()).not.toContain('paste-stale.png')
  })

  it('never touches a file it did not write', () => {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(join(DIR, 'diagram.png'), 'x')
    age('diagram.png', 30)
    saveImage(CWD, 'image/png', PNG)
    expect(readdirSync(DIR)).toContain('diagram.png')
  })
})
