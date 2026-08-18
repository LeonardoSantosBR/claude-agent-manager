import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import pty from 'node-pty'
import type { IPty } from 'node-pty'
import type { LoginState } from '../shared/types.ts'
import { CLAUDE_BIN, claudeEnv, CREDENTIALS_FILE, readAuth } from './config.ts'

/**
 * Logging in means running `claude` once and answering its wizard. We do that in
 * a hidden PTY instead of asking the user to open a terminal: the wizard's first
 * answers are the defaults we want, so we press Enter for them, scrape the OAuth
 * URL it prints, and hand that URL to the browser. The code the browser gives
 * back is typed into the same PTY via submitCode().
 */

/** Wide enough that the CLI doesn't wrap the (very long) OAuth URL. */
const COLS = 512
const ROWS = 40
/** Enter presses that walk past the theme / login-method menus. */
const ENTER_TRIES = 5
const ENTER_EVERY = 1200
/** Give up looking for the URL after this — the wizard changed, most likely. */
const URL_TIMEOUT = 60_000
/** How much of the CLI screen we keep to show when something goes wrong. */
const TAIL = 3000

// CSI sequences, OSC strings (window title) and charset/keypad escapes. Built
// from fromCharCode so the ESC byte doesn't sit invisible in the source.
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${ESC}]*|${ESC}[()][A-B0-9]|${ESC}[=>]`,
  'g',
)
const URLS = /https?:\/\/[^\s"'`]+/g

const strip = (chunk: string) => chunk.replace(ANSI, '')

/**
 * The login screen also prints marketing/docs links, so "any URL" isn't enough —
 * only the OAuth one takes you somewhere that returns a code.
 */
function findOauthUrl(text: string): string | null {
  for (const url of text.match(URLS) ?? []) {
    if (/oauth|authorize/i.test(url)) return url.replace(/[.,)\]]+$/, '')
  }
  return null
}

class LoginFlow {
  proc: IPty | null = null
  url: string | null = null
  error: string | null = null
  done = false
  text = ''
  private timers: NodeJS.Timeout[] = []

  start() {
    try {
      this.proc = pty.spawn(CLAUDE_BIN, [], {
        name: 'xterm-256color',
        cwd: homedir(),
        cols: COLS,
        rows: ROWS,
        env: claudeEnv(),
        // Killing a ConPTY whose process already exited makes node-pty launch
        // conpty_console_list_agent.js, which dies with "AttachConsole failed"
        // and spews a stack trace over the server log. This flow always races
        // that way — the wizard exits on its own right as we clean up — so it
        // runs on winpty, where the kill has no console agent to attach to.
        useConpty: false,
      })
    } catch (failure) {
      this.error = `could not run ${CLAUDE_BIN}: ${(failure as Error).message}`
      return
    }

    this.proc.onData((chunk) => {
      this.text = (this.text + strip(chunk)).slice(-TAIL)
      if (!this.url) this.url = findOauthUrl(this.text)
    })
    this.proc.onExit(() => {
      this.proc = null
      // Exiting before the credentials land means the wizard was aborted.
      if (!this.done && !existsSync(CREDENTIALS_FILE)) {
        this.error ??= 'the claude login exited before finishing'
      }
    })

    for (let i = 1; i <= ENTER_TRIES; i++) {
      this.after(ENTER_EVERY * i, () => {
        if (!this.url) this.write('\r')
      })
    }
    this.after(URL_TIMEOUT, () => {
      if (!this.url && !this.done) {
        this.error ??= "couldn't find the login URL in claude's output"
      }
    })

    // The credentials file is the only unambiguous "it worked" signal: the CLI
    // just drops into its normal prompt afterwards.
    const watch = setInterval(() => {
      if (!existsSync(CREDENTIALS_FILE)) return
      this.done = true
      clearInterval(watch)
      // A beat before killing it, so the CLI finishes writing its config.
      this.after(1000, () => this.stop())
    }, 700)
    this.timers.push(watch)
  }

  private after(ms: number, run: () => void) {
    this.timers.push(setTimeout(run, ms))
  }

  write(data: string) {
    try {
      this.proc?.write(data)
    } catch {
      /* pty already died */
    }
  }

  stop() {
    // Node's Timeout covers both kinds, so one clear call drains the list.
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    try {
      this.proc?.kill()
    } catch {
      /* already gone */
    }
    this.proc = null
  }

  state(): LoginState {
    if (this.done) return { phase: 'done', url: this.url, output: this.text, error: null }
    if (this.error) return { phase: 'error', url: this.url, output: this.text, error: this.error }
    if (this.url) return { phase: 'url', url: this.url, output: this.text, error: null }
    return { phase: 'starting', url: null, output: this.text, error: null }
  }
}

const IDLE: LoginState = { phase: 'idle', url: null, output: '', error: null }

let flow: LoginFlow | null = null

export function startLogin(): LoginState {
  cancelLogin()
  flow = new LoginFlow()
  flow.start()
  return flow.state()
}

export function loginState(): LoginState {
  return flow?.state() ?? IDLE
}

/** The code pasted back from the browser, typed into the waiting wizard. */
export function submitCode(code: string): LoginState {
  if (!flow) return IDLE
  flow.write(`${code.trim()}\r`)
  return flow.state()
}

export function cancelLogin() {
  flow?.stop()
  flow = null
}

/**
 * Same thing `/logout` does inside Claude Code: drop the tokens. The account
 * stays named in .claude.json, which is why readAuth() ignores that name once
 * the credentials are gone.
 */
export function logout() {
  cancelLogin()
  rmSync(CREDENTIALS_FILE, { force: true })
  return readAuth()
}
