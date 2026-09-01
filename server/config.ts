import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AccountIdentity, AuthStatus } from '../shared/types.ts'
import { which } from './which.ts'

export const PORT = Number(process.env.PORT ?? 5174)

/**
 * Loopback only, deliberately. Every endpoint here can spawn a `claude` in any
 * folder on this machine, with the tokens of whoever is logged in — binding to
 * 0.0.0.0 would hand remote code execution to anyone on the same Wi-Fi. Set
 * HOST to open it up on purpose (and put something in front of it).
 */
export const HOST = process.env.HOST ?? '127.0.0.1'

/**
 * A page on any origin can POST to http://localhost:5174 from the browser of
 * whoever is running this. JSON bodies and websockets both carry an Origin
 * header, so we can just refuse the ones that aren't ours; requests with no
 * Origin at all (curl, the app's own server-side calls) are not browser-driven
 * and pass. VITE_* dev ports vary, so any loopback origin is accepted.
 */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  return LOOPBACK_ORIGIN.test(origin)
}

/**
 * Where we keep our own state (nicknames, groups).
 * Overridable so a test instance can run without touching the real one.
 */
export const STATE_DIR =
  process.env.AGENT_MANAGER_STATE_DIR ?? join(homedir(), '.config', 'claude-agent-manager')
export const STATE_FILE = join(STATE_DIR, 'state.json')

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p)
}

/**
 * The claude binary. Resolved once at boot because the server's PATH may differ
 * from the interactive shell's — and because node-pty needs a full path with the
 * extension on Windows (see which()).
 */
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? which('claude') ?? 'claude'

/**
 * The one config dir the manager drives: Claude Code's default. We deliberately
 * never set CLAUDE_CONFIG_DIR — pointing it at ~/.claude is *not* a no-op (Claude
 * then looks for .claude.json inside the dir and loses MCP servers, project trust
 * and friends). Leaving it unset is what makes an agent spawned here identical to
 * a `claude` typed in a terminal.
 */
export const CONFIG_DIR = join(homedir(), '.claude')
/** The OAuth tokens. Its existence is what "logged in" means. */
export const CREDENTIALS_FILE = join(CONFIG_DIR, '.credentials.json')
/** Config lives *next to* the dir, not inside it — because the var is unset. */
export const CONFIG_JSON = join(homedir(), '.claude.json')

export function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

/**
 * Variables a running Claude Code injects into its own child processes. They
 * describe *that* session, so they must never reach a process we spawn: started
 * from a terminal that already belongs to a Claude session (a VSCode integrated
 * terminal, say), every agent here would come up believing it is that session's
 * child — pointing at a messaging socket and an IDE port that aren't its own.
 * Anything else (including the user's own CLAUDE_CODE_* flags) passes through.
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

/** Environment for every claude we spawn — agents and the login flow alike. */
export function claudeEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
  }
  for (const leaked of INHERITED_SESSION_VARS) delete env[leaked]
  // See CONFIG_DIR: the default dir runs with the variable unset.
  delete env.CLAUDE_CONFIG_DIR
  return env
}

/**
 * Which Claude account this machine is signed into, read from .claude.json.
 * `.credentials.json` only tells us that *some* login happened; this is what
 * puts a name on it.
 */
function readIdentity(): AccountIdentity | null {
  if (!existsSync(CONFIG_JSON)) return null
  try {
    // JSON.parse tolerates the duplicate project keys this file accumulates
    // (same path in different letter case) — a stricter parser would throw.
    const parsed = JSON.parse(readFileSync(CONFIG_JSON, 'utf8')) as {
      oauthAccount?: { emailAddress?: string; organizationName?: string; accountUuid?: string }
    }
    const account = parsed.oauthAccount
    if (!account?.accountUuid) return null
    return {
      email: account.emailAddress ?? '',
      organization: account.organizationName ?? null,
      uuid: account.accountUuid,
    }
  } catch {
    // Unreadable or malformed: treat as unknown rather than taking the server down.
    return null
  }
}

export function readAuth(): AuthStatus {
  const loggedIn = existsSync(CREDENTIALS_FILE)
  return {
    loggedIn,
    // A stale oauthAccount survives a logout, so only trust it while logged in.
    identity: loggedIn ? readIdentity() : null,
    configDir: CONFIG_DIR,
  }
}
