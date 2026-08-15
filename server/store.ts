import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Group, SessionMeta } from '../shared/types.ts'
import { ensureStateDir, STATE_FILE } from './config.ts'

export interface PersistedState {
  sessions: SessionMeta[]
  groups: Group[]
}

/**
 * Persists metadata only (nickname, folder, account, group). PTYs die with the
 * server, so everything that was running comes back as 'stopped' — and can be
 * revived with --resume, since the id *is* Claude's own session id.
 */
export function loadState(): PersistedState {
  if (!existsSync(STATE_FILE)) return { sessions: [], groups: [] }
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as
      | SessionMeta[]
      | Partial<PersistedState>
    // Legacy format: the file used to be just the sessions array.
    const raw: Partial<PersistedState> = Array.isArray(parsed)
      ? { sessions: parsed, groups: [] }
      : parsed

    return {
      groups: raw.groups ?? [],
      sessions: (raw.sessions ?? []).map((session) => ({
        ...session,
        groupId: session.groupId ?? null,
        status: 'stopped',
        exitCode: null,
      })),
    }
  } catch {
    return { sessions: [], groups: [] }
  }
}

let pending: NodeJS.Timeout | null = null

export function saveState(state: PersistedState) {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    ensureStateDir()
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
    pending = null
  }, 250)
}
