import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Account } from '../shared/types.ts'

export const PORT = Number(process.env.PORT ?? 5174)

/** Onde guardamos nosso próprio estado (apelidos das sessões, contas). */
export const STATE_DIR = join(homedir(), '.config', 'claude-agent-manager')
export const STATE_FILE = join(STATE_DIR, 'state.json')
export const ACCOUNTS_FILE = join(STATE_DIR, 'accounts.json')

export function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p)
}

/**
 * `~/.claude` é o config dir padrão — mas com CLAUDE_CONFIG_DIR setado o Claude
 * Code passa a procurar o .claude.json *dentro* dele, em vez de em ~/.claude.json.
 * Setar a variável pra esse caminho não é no-op: derruba MCP servers, trust de
 * projeto e afins. Então, pra conta padrão, a gente simplesmente não seta.
 */
export function isDefaultConfigDir(dir: string): boolean {
  return expandHome(dir) === join(homedir(), '.claude')
}

/**
 * O binário do claude. Resolvido uma vez no boot porque o PATH do servidor pode
 * não ser o mesmo do shell interativo.
 */
export const CLAUDE_BIN = (() => {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN
  try {
    return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim()
  } catch {
    return 'claude'
  }
})()

const DEFAULT_ACCOUNTS: Omit<Account, 'loggedIn'>[] = [
  { id: 'personal', label: 'Pessoal', configDir: '~/.claude', color: '#FF6C37' },
  { id: 'work', label: 'Empresa', configDir: '~/.claude-work', color: '#4EA1FF' },
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
