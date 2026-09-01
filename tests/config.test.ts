import { describe, expect, it } from 'vitest'
import { HOST, originAllowed } from '../server/config.ts'

/**
 * This is the whole security model: loopback bind plus an Origin check. A
 * regression here hands a website open in the user's browser a PTY that can run
 * anything on their machine, so it gets tested first.
 */
describe('originAllowed', () => {
  it('accepts the app itself, on whatever port vite ended up on', () => {
    expect(originAllowed('http://localhost:5173')).toBe(true)
    expect(originAllowed('http://localhost:5174')).toBe(true)
    expect(originAllowed('http://127.0.0.1:5173')).toBe(true)
    expect(originAllowed('http://[::1]:5173')).toBe(true)
    expect(originAllowed('https://localhost')).toBe(true)
  })

  it('accepts a request with no Origin at all — not browser-driven', () => {
    expect(originAllowed(undefined)).toBe(true)
    expect(originAllowed('')).toBe(true)
  })

  it('rejects any other site', () => {
    expect(originAllowed('https://evil.com')).toBe(false)
    expect(originAllowed('http://example.org:5173')).toBe(false)
    expect(originAllowed('null')).toBe(false) // sandboxed iframe / file://
  })

  it('rejects hostnames that merely contain a loopback name', () => {
    expect(originAllowed('http://localhost.evil.com')).toBe(false)
    expect(originAllowed('http://evil.com/localhost')).toBe(false)
    expect(originAllowed('http://notlocalhost')).toBe(false)
    expect(originAllowed('http://127.0.0.1.evil.com')).toBe(false)
    // A URL-ish string whose loopback part is only the userinfo.
    expect(originAllowed('http://localhost@evil.com')).toBe(false)
  })

  it('binds to loopback unless HOST says otherwise', () => {
    expect(HOST).toBe('127.0.0.1')
  })
})
