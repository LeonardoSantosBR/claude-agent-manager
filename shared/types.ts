/** Types shared between the server (node) and the front end (vite/react). */

/**
 * Who the machine's Claude Code is signed in as. There is a single login: the
 * manager drives `~/.claude` and never sets CLAUDE_CONFIG_DIR, so an agent it
 * spawns is on exactly the same account as a `claude` typed in a terminal.
 */
export interface AuthStatus {
  /** does .credentials.json exist in the config dir? */
  loggedIn: boolean
  /** Read from .claude.json — null when logged out, or on an API-key login. */
  identity: AccountIdentity | null
  configDir: string
}

export interface AccountIdentity {
  email: string
  /** null on a personal (non-org) account. */
  organization: string | null
  /** Claude's own account id. */
  uuid: string
}

export type LoginPhase = 'idle' | 'starting' | 'url' | 'done' | 'error'

/**
 * State of the login the server drives for us: it runs `claude`, walks past the
 * first menus and scrapes the OAuth URL, which the browser then opens.
 */
export interface LoginState {
  phase: LoginPhase
  /** OAuth URL to open in the browser. Set once phase is 'url'. */
  url: string | null
  /** Tail of the CLI output, ANSI stripped — what to show when it goes wrong. */
  output: string
  error: string | null
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
  preview: string
  updatedAt: number
  /** already open as a live session in the manager? */
  open: boolean
}

export interface CreateSessionBody {
  name?: string
  cwd: string
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
  /**
   * The replayed screen has been repainted by the agent, so the cursor the
   * client sees is the cursor the PTY has. Claude echoes a typed character as a
   * bare byte at wherever the cursor happens to be — type before this and the
   * letter lands beside the prompt instead of inside it, so the pane holds
   * keystrokes until it arrives.
   */
  | { type: 'synced' }
