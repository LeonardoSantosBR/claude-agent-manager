import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { SessionMeta } from '../shared/types.ts'
import { ensureStateDir, STATE_FILE } from './config.ts'

/**
 * Persiste só os metadados (apelido, pasta, conta). Os PTYs morrem junto com o
 * servidor, então tudo que estava rodando volta como 'stopped' — e daí dá pra
 * ressuscitar com --resume, já que o id é o próprio session id do Claude.
 */
export function loadSessions(): SessionMeta[] {
  if (!existsSync(STATE_FILE)) return []
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as SessionMeta[]
    return parsed.map((s) => ({ ...s, status: 'stopped', exitCode: null }))
  } catch {
    return []
  }
}

let pending: NodeJS.Timeout | null = null

export function saveSessions(sessions: SessionMeta[]) {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    ensureStateDir()
    writeFileSync(STATE_FILE, JSON.stringify(sessions, null, 2))
    pending = null
  }, 250)
}
