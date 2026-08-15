import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { Account, CreateSessionBody, SessionMeta } from '../shared/types.ts'
import { CLAUDE_BIN, expandHome, isDefaultConfigDir } from './config.ts'
import { loadSessions, saveSessions } from './store.ts'

/** Quanto de saída guardamos por sessão pra reenviar quando um cliente conecta. */
const SCROLLBACK_LIMIT = 512 * 1024

interface LiveSession {
  meta: SessionMeta
  proc: IPty | null
  /** buffer circular de bytes crus (com ANSI) pro replay. */
  buffer: string
  listeners: Set<(chunk: string) => void>
  cols: number
  rows: number
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, LiveSession>()
  private getAccounts: () => Account[]

  constructor(getAccounts: () => Account[]) {
    super()
    this.getAccounts = getAccounts
    for (const meta of loadSessions()) {
      this.sessions.set(meta.id, {
        meta,
        proc: null,
        buffer: '',
        listeners: new Set(),
        cols: 120,
        rows: 30,
      })
    }
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()]
      .map((s) => s.meta)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  get(id: string): LiveSession | undefined {
    return this.sessions.get(id)
  }

  private account(id: string): Account {
    const found = this.getAccounts().find((a) => a.id === id)
    if (!found) throw new Error(`conta desconhecida: ${id}`)
    return found
  }

  private persist() {
    saveSessions(this.list())
    this.emit('sessions', this.list())
  }

  create(body: CreateSessionBody): SessionMeta {
    const cwd = expandHome(body.cwd)
    if (!existsSync(cwd)) throw new Error(`pasta não existe: ${cwd}`)
    const account = this.account(body.accountId)

    // Reaproveitar o id do histórico mantém a sessão retomada como *a mesma*
    // sessão do Claude, em vez de criar uma cópia paralela.
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

  /** Reinicia uma sessão parada retomando o histórico do Claude (--resume). */
  restart(id: string): SessionMeta {
    const session = this.sessions.get(id)
    if (!session) throw new Error('sessão não encontrada')
    if (session.proc) return session.meta
    session.buffer = ''
    this.spawn(session, true)
    this.persist()
    return session.meta
  }

  private spawn(session: LiveSession, resume: boolean) {
    const account = this.account(session.meta.accountId)
    const args = resume
      ? ['--resume', session.meta.id]
      : ['--session-id', session.meta.id]

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '3',
    }

    // É daqui que sai a separação entre as duas contas Pro: cada config dir tem
    // seu próprio .credentials.json. A conta padrão roda sem a variável — ver
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
      session.buffer += chunk
      if (session.buffer.length > SCROLLBACK_LIMIT) {
        session.buffer = session.buffer.slice(-SCROLLBACK_LIMIT)
      }
      session.meta.lastActivityAt = Date.now()
      for (const listener of session.listeners) listener(chunk)
    })

    proc.onExit(({ exitCode }) => {
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
      /* pty já morreu */
    }
  }

  /**
   * Reenvia o scrollback e devolve o unsubscribe. O nudge de resize força a TUI
   * do Claude a se redesenhar inteira — sem isso a tela reconectada fica com o
   * lixo do replay.
   */
  attach(id: string, listener: (chunk: string) => void): () => void {
    const session = this.sessions.get(id)
    if (!session) throw new Error('sessão não encontrada')
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
    if (!session) throw new Error('sessão não encontrada')
    session.meta.name = name.trim() || session.meta.project
    this.persist()
    return session.meta
  }

  stop(id: string) {
    const session = this.sessions.get(id)
    if (!session?.proc) return
    session.proc.kill()
  }

  remove(id: string) {
    const session = this.sessions.get(id)
    if (!session) return
    session.proc?.kill()
    this.sessions.delete(id)
    this.persist()
  }
}
