import { describe, expect, it } from 'vitest'
import { findOauthUrl } from '../server/auth.ts'

/**
 * The login wizard prints docs and marketing links next to the one URL that
 * actually returns a code, so "the first URL on screen" is the wrong answer.
 */
describe('findOauthUrl', () => {
  it('picks the oauth URL out of the wizard output', () => {
    const screen = [
      'Welcome to Claude Code! Docs: https://docs.claude.com/claude-code',
      'Browser didn’t open? Use the url below:',
      'https://claude.ai/oauth/authorize?client_id=abc&scope=user',
    ].join('\n')
    expect(findOauthUrl(screen)).toBe('https://claude.ai/oauth/authorize?client_id=abc&scope=user')
  })

  it('trims the punctuation a wrapped line leaves stuck to the URL', () => {
    expect(findOauthUrl('go to https://claude.ai/oauth/authorize?x=1.')).toBe(
      'https://claude.ai/oauth/authorize?x=1',
    )
    expect(findOauthUrl('(https://claude.ai/oauth/authorize?x=1)')).toBe(
      'https://claude.ai/oauth/authorize?x=1',
    )
  })

  it('returns null while the wizard has printed nothing usable', () => {
    expect(findOauthUrl('')).toBe(null)
    expect(findOauthUrl('Choose a theme: Dark mode')).toBe(null)
    expect(findOauthUrl('see https://docs.claude.com/claude-code for help')).toBe(null)
  })
})
