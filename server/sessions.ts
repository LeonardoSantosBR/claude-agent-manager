import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Account, CreateSessionBody, Group, SessionMeta } from '../shared/types.ts'
import { CLAUDE_BIN, expandHome, isDefaultConfigDir } from './config.ts'
import { hasSessionHistory } from './history.ts'
import { dropScrollback, flushScrollback, readScrollback, saveScrollback } from './scrollback.ts'
import { loadState, saveState } from './store.ts'

/** How much output we keep per session to replay when a client connects. */
const SCROLLBACK_LIMIT = 512 * 1024

/**
 * Variables a running Claude Code injects into its own child processes. They
 * describe *that* session, so they must never reach a session we spawn.
 * Anything else (including the user's own CLAUDE_CODE_* feature flags) passes
 * through untouched.
 */
const INHERITED_SESSION_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SSE_PORT',
]

interface LiveSession {
  meta: SessionMeta
  proc: IPty | null
  /** ring buffer of raw bytes (ANSI included) for the replay. */
  buffer: string
  listeners: Set<(chunk: string) => void>
  /** set on restart: the first chunk of the new process replaces the old screen. */
  resetOnNextChunk?: boolean
  cols: number
  rows: number
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, LiveSession>()
  private groups = new Map<string, Group>()
  private getAccounts: () => Account[]

  constructor(getAccounts: () => Account[]) {
    super()
    this.getAccounts = getAccounts
    const state = loadState()
    for (const group of state.groups) this.groups.set(group.id, group)
    for (const meta of state.sessions) {
      this.sessions.set(meta.id, {
        meta,
        proc: null,
        // Last rendered screen from before the restart, so the pane isn't blank.
        buffer: readScrollback(meta.id),
        listeners: new Set(),
        cols: 120,
        rows: 30,
      })
    }
  }

  /**
   * Creation order, oldest first — same rule as listGroups(). Sorting by
   * lastActivityAt would make the sidebar reshuffle itself on every chunk of
   * output, so a session you're watching keeps moving under the cursor.
   */
  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((s) => s.meta)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  listGroups(): Group[] {
    return [...this.groups.values()].sort((a, b) => a.createdAt - b.createdAt)
  }

  createGroup(name: string, cwd?: string | null): Group {
    const group: Group = {
      id: randomUUID(),
      name: name.trim() || 'New group',
      cwd: cwd ? expandHome(cwd) : null,
      collapsed: false,
      createdAt: Date.now(),
    }
    this.groups.set(group.id, group)
    this.persist()
    return group
  }

  updateGroup(id: string, patch: Partial<Pick<Group, 'name' | 'cwd' | 'collapsed'>>): Group {
    const group = this.groups.get(id)
    if (!group) throw new Error('group not found')
    if (patch.name !== undefined) group.name = patch.name.trim() || group.name
    if (patch.cwd !== undefined) group.cwd = patch.cwd ? expandHome(patch.cwd) : null
    if (patch.collapsed !== undefined) group.collapsed = patch.collapsed
    this.persist()
    return group
  }

  /** Deleting a group doesn't delete sessions — they just fall back to "No group". */
  removeGroup(id: string) {
    if (!this.groups.delete(id)) return
    for (const session of this.sessions.values()) {
      if (session.meta.groupId === id) session.meta.groupId = null
    }
    this.persist()
  }

  moveSession(id: string, groupId: string | null): SessionMeta {
    const session = this.sessions.get(id)
    if (!session) throw new Error('session not found')
    if (groupId && !this.groups.has(groupId)) throw new Error('group not found')
    session.meta.groupId = groupId
    this.persist()
    return session.meta
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  private account(id: string): Account {
    const found = this.getAccounts().find((a) => a.id === id)
    if (!found) throw new Error(`unknown account: ${id}`)
    return found
  }

  private persist() {
    const state = { sessions: this.list(), groups: this.listGroups() }
    saveState(state)
    this.emit('state', state)
  }

  create(body: CreateSessionBody): SessionMeta {
    const cwd = expandHome(body.cwd)
    if (!existsSync(cwd)) throw new Error(`folder does not exist: ${cwd}`)
    const account = this.account(body.accountId)

    const group = body.newGroupName?.trim()
      ? this.createGroup(body.newGroupName, cwd)
      : body.groupId
        ? this.groups.get(body.groupId)
        : null
    if (body.groupId && !group) throw new Error('group not found')
    // The group learns its folder from the first session dropped into it, to
    // prefill the next ones.
    if (group && !group.cwd) group.cwd = cwd

    // Reusing the history id keeps the resumed session as *the same* Claude
    // session, instead of creating a parallel copy.
    const id = body.resumeId ?? randomUUID()
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!
      if (existing.proc) return existing.meta
      this.sessions.delete(id)
    }

    const meta: SessionMeta = {
      id,
      name: body.name?.trim() || basename(cwd),
      cwd,
      project: basename(cwd),
      groupId: group?.id ?? null,
      accountId: account.id,
      status: 'stopped',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      exitCode: null,
      resumed: Boolean(body.resumeId),
    }

    const session: LiveSession = {
      meta,
      proc: null,
      buffer: '',
      listeners: new Set(),
      cols: 120,
      rows: 30,
    }
    this.sessions.set(id, session)
    this.spawn(session, Boolean(body.resumeId))
    this.persist()
    return meta
  }

  /** Restarts a stopped session, resuming Claude's history (--resume). */
  restart(id: string): SessionMeta {
    const session = this.sessions.get(id)
    if (!session) throw new Error('session not found')
    if (session.proc) return session.meta
    // Keep the old screen up until the new process draws — if the spawn fails,
    // its error lands on top instead of leaving a blank pane.
    session.resetOnNextChunk = true
    this.spawn(session, true)
    this.persist()
    return session.meta
  }

  private spawn(session: LiveSession, resume: boolean) {
    const account = this.account(session.meta.accountId)
    // A session that never exchanged a message has no .jsonl yet, and
    // `claude --resume` bails with "No conversation found" and exits. Fall back
    // to starting fresh under the same id, so the session keeps its identity.
    const canResume = resume && hasSessionHistory(account.configDir, session.meta.id)
    const args = canResume
      ? ['--resume', session.meta.id]
      : ['--session-id', session.meta.id]

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
    }

    // Started from a terminal that already belongs to a Claude session (a VSCode
    // integrated terminal, say), the whole parent environment would be inherited
    // and every agent here would come up believing it is that session's child —
    // pointing at a messaging socket and an IDE port that aren't its own.
    for (const leaked of INHERITED_SESSION_VARS) delete env[leaked]

    // This is what separates the two Pro accounts: each config dir has its own
    // .credentials.json. The default account runs without the variable — see
    // isDefaultConfigDir().
    if (isDefaultConfigDir(account.configDir)) {
      delete env.CLAUDE_CONFIG_DIR
    } else {
      env.CLAUDE_CONFIG_DIR = account.configDir
    }

    const proc = pty.spawn(CLAUDE_BIN, args, {
      name: 'xterm-256color',
      cwd: session.meta.cwd,
      cols: session.cols,
      rows: session.rows,
      env,
    })

    session.proc = proc
    session.meta.status = 'running'
    session.meta.exitCode = null
    session.meta.lastActivityAt = Date.now()

    proc.onData((chunk) => {
      if (session.resetOnNextChunk) {
        session.buffer = ''
        session.resetOnNextChunk = false
      }
      session.buffer += chunk
      if (session.buffer.length > SCROLLBACK_LIMIT) {
        session.buffer = session.buffer.slice(-SCROLLBACK_LIMIT)
      }
      session.meta.lastActivityAt = Date.now()
      saveScrollback(session.meta.id, session.buffer)
      for (const listener of session.listeners) listener(chunk)
    })

    proc.onExit(({ exitCode }) => {
      // The final screen matters most — it's what you come back to.
      saveScrollback(session.meta.id, session.buffer)
      flushScrollback()
      session.proc = null
      session.meta.status = 'stopped'
      session.meta.exitCode = exitCode
      session.meta.lastActivityAt = Date.now()
      this.emit('exit', session.meta.id, exitCode)
      this.persist()
    })
  }

  write(id: string, data: string) {
    const session = this.sessions.get(id)
    if (!session?.proc) return
    session.proc.write(data)
    session.meta.lastActivityAt = Date.now()
  }

  resize(id: string, cols: number, rows: number) {
    const session = this.sessions.get(id)
    if (!session) return
    session.cols = cols
    session.rows = rows
    try {
      session.proc?.resize(cols, rows)
    } catch {
      /* pty already died */
    }
  }

  /**
   * Replays the scrollback and returns the unsubscribe. The resize nudge forces
   * Claude's TUI to redraw in full — without it, a reconnected screen keeps the
   * garbage left by the replay.
   */
  attach(id: string, listener: (chunk: string) => void): () => void {
    const session = this.sessions.get(id)
    if (!session) throw new Error('session not found')
    if (session.buffer) listener(session.buffer)
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }

  nudge(id: string) {
    const session = this.sessions.get(id)
    if (!session?.proc) return
    const { cols, rows } = session
    try {
      session.proc.resize(Math.max(20, cols - 1), rows)
      setTimeout(() => {
        try {
          session.proc?.resize(cols, rows)
        } catch {
          /* ignore */
        }
      }, 30)
    } catch {
      /* ignore */
    }
  }

  rename(id: string, name: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error('session not found')
    session.meta.name = name.trim() || session.meta.project
    this.persist()
    return session.meta
  }

  stop(id: string) {
    const session = this.sessions.get(id)
    if (!session?.proc) return
    session.proc.kill()
  }

  /** Flushes every live session's screen to disk before the process dies. */
  shutdown() {
    for (const session of this.sessions.values()) {
      if (session.buffer) saveScrollback(session.meta.id, session.buffer)
    }
    flushScrollback()
  }

  remove(id: string) {
    const session = this.sessions.get(id)
    if (!session) return
    session.proc?.kill()
    dropScrollback(id)
    this.sessions.delete(id)
    this.persist()
  }
}
