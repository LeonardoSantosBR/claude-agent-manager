import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Account } from '../shared/types.ts'
import { which } from './which.ts'

export const PORT = Number(process.env.PORT ?? 5174)

/**
 * Where we keep our own state (nicknames, groups, accounts).
 * Overridable so a test instance can run without touching the real one.
 */
export const STATE_DIR =
  process.env.AGENT_MANAGER_STATE_DIR ?? join(homedir(), '.config', 'claude-agent-manager')
export const STATE_FILE = join(STATE_DIR, 'state.json')
export const ACCOUNTS_FILE = join(STATE_DIR, 'accounts.json')

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p)
}

/**
 * `~/.claude` is the default config dir — but with CLAUDE_CONFIG_DIR set, Claude
 * Code starts looking for .claude.json *inside* it instead of at ~/.claude.json.
 * Setting the variable to that path is not a no-op: it drops MCP servers, project
 * trust and friends. So for the default account we simply don't set it.
 */
export function isDefaultConfigDir(dir: string): boolean {
  return expandHome(dir) === join(homedir(), '.claude')
}

/**
 * The claude binary. Resolved once at boot because the server's PATH may differ
 * from the interactive shell's — and because node-pty needs a full path with the
 * extension on Windows (see which()).
 */
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? which('claude') ?? 'claude'

const DEFAULT_ACCOUNTS: Omit<Account, 'loggedIn'>[] = [
  { id: 'personal', label: 'Personal', configDir: '~/.claude', color: '#FF6C37' },
  { id: 'work', label: 'Work', configDir: '~/.claude-work', color: '#4EA1FF' },
]

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
}

export function loadAccounts(): Account[] {
  ensureStateDir()
  if (!existsSync(ACCOUNTS_FILE)) {
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(DEFAULT_ACCOUNTS, null, 2))
  }
  let raw: Omit<Account, 'loggedIn'>[]
  try {
    raw = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf8'))
  } catch {
    raw = DEFAULT_ACCOUNTS
  }
  return raw.map((a) => {
    const dir = expandHome(a.configDir)
    return {
      ...a,
      configDir: dir,
      // No Linux o Claude Code guarda o OAuth em .credentials.json dentro do config dir.
      loggedIn: existsSync(join(dir, '.credentials.json')),
    }
  })
}

export function saveAccounts(accounts: Omit<Account, 'loggedIn'>[]) {
  ensureStateDir()
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2))
}

export { ensureStateDir }
