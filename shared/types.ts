/** Types shared between the server (node) and the front end (vite/react). */

export interface Account {
  id: string
  label: string
  /** Directory passed as CLAUDE_CONFIG_DIR when spawning the agent. */
  configDir: string
  color: string
  /** Computed by the server: does .credentials.json exist in that configDir? */
  loggedIn: boolean
}

/**
 * A group works like a Postman collection: you create it, name it, and hang as
 * many sessions off it as you want. Its folder is learned from the first
 * session created inside, to prefill the next ones.
 */
export interface Group {
  id: string
  name: string
  cwd: string | null
  collapsed: boolean
  createdAt: number
}

export type SessionStatus = 'running' | 'stopped'

export interface SessionMeta {
  /** Claude Code session UUID — the same id used in --session-id/--resume. */
  id: string
  name: string
  cwd: string
  /** basename(cwd) — used only as a label/fallback. */
  project: string
  /** null = loose, shows up under "No group". */
  groupId: string | null
  accountId: string
  status: SessionStatus
  createdAt: number
  lastActivityAt: number
  exitCode: number | null
  /** true when the session was born from a --resume of history. */
  resumed: boolean
}

export interface HistorySession {
  id: string
  cwd: string
  project: string
  accountId: string
  preview: string
  updatedAt: number
  /** already open as a live session in the manager? */
  open: boolean
}

export interface CreateSessionBody {
  name?: string
  cwd: string
  accountId: string
  groupId?: string | null
  /** creates the group on the spot and drops the session into it. */
  newGroupName?: string
  /** id of a history session to resume via --resume. */
  resumeId?: string
}

/** client -> server, over the session websocket. */
export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

/** server -> client. */
export type ServerMessage =
  | { type: 'data'; data: string }
  | { type: 'exit'; code: number | null }
  | { type: 'state'; sessions: SessionMeta[]; groups: Group[] }
