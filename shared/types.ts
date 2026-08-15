/** Tipos compartilhados entre o servidor (node) e o front (vite/react). */

export interface Account {
  id: string
  label: string
  /** Diretório passado como CLAUDE_CONFIG_DIR ao spawnar o agente. */
  configDir: string
  color: string
  /** Calculado pelo servidor: existe .credentials.json nesse configDir? */
  loggedIn: boolean
}

export type SessionStatus = 'running' | 'stopped'

export interface SessionMeta {
  /** UUID da sessão do Claude Code — é o mesmo id usado em --session-id/--resume. */
  id: string
  name: string
  cwd: string
  /** basename(cwd), usado pra agrupar a sidebar. */
  project: string
  accountId: string
  status: SessionStatus
  createdAt: number
  lastActivityAt: number
  exitCode: number | null
  /** true quando a sessão nasceu de um --resume de histórico. */
  resumed: boolean
}

export interface HistorySession {
  id: string
  cwd: string
  project: string
  accountId: string
  preview: string
  updatedAt: number
  /** já está aberta como sessão viva no manager? */
  open: boolean
}

export interface CreateSessionBody {
  name?: string
  cwd: string
  accountId: string
  /** id de uma sessão do histórico pra retomar via --resume. */
  resumeId?: string
}

/** client -> server, no websocket da sessão. */
export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

/** server -> client. */
export type ServerMessage =
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'sessions'; sessions: SessionMeta[] }
