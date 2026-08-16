import { useEffect, useRef, useState } from 'react'
import type { LoginState } from '../../shared/types.ts'
import { api } from '../api.ts'

interface Props {
  onClose: () => void
  /** Fired once the credentials land, so the app can refresh who's logged in. */
  onDone: () => void
}

const POLL_MS = 800

const STARTING: LoginState = { phase: 'starting', url: null, output: '', error: null }

/**
 * The server runs `claude` for us and scrapes the OAuth URL out of it. This
 * modal opens that URL in the browser the app is already running in, then types
 * the code the browser hands back into the same waiting CLI.
 */
export function LoginModal(props: Props) {
  const [state, setState] = useState<LoginState>(STARTING)
  const [code, setCode] = useState('')
  const [failed, setFailed] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  // Opening once per URL: the poll keeps returning the same one.
  const opened = useRef<string | null>(null)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      if (stop) return
      try {
        setState(await api.loginState())
      } catch (error) {
        setFailed((error as Error).message)
      }
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    api
      .login()
      .then((next) => {
        if (!stop) setState(next)
      })
      .catch((error: Error) => setFailed(error.message))
      .finally(() => {
        timer = setTimeout(() => void poll(), POLL_MS)
      })

    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [])

  // The pop-up blocker only lets this through because the click that opened the
  // modal is still recent; the link below is the fallback when it doesn't.
  useEffect(() => {
    if (state.url && opened.current !== state.url) {
      opened.current = state.url
      window.open(state.url, '_blank', 'noopener,noreferrer')
    }
  }, [state.url])

  // Through a ref because props change identity on every render, and onDone
  // must fire once — when the phase flips, not on each poll.
  const onDone = useRef(props.onDone)
  useEffect(() => {
    onDone.current = props.onDone
  })
  useEffect(() => {
    if (state.phase === 'done') onDone.current()
  }, [state.phase])

  const cancel = () => {
    void api.loginCancel().catch(() => {})
    props.onClose()
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return
    setSent(true)
    try {
      setState(await api.loginCode(code))
      setCode('')
    } catch (error) {
      setFailed((error as Error).message)
    }
  }

  const error = failed ?? state.error

  return (
    <div className="modal-backdrop" onClick={cancel}>
      <form className="modal login-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Log in to Claude</h2>

        {state.phase === 'done' ? (
          <p className="login-step">Logged in. You can close this.</p>
        ) : (
          <>
            <p className="login-step">
              {state.url
                ? '1. Authorize in the browser tab that just opened, 2. paste the code it gives you below.'
                : 'Starting the Claude CLI and waiting for its login link…'}
            </p>

            {state.url && (
              <>
                <a className="login-url" href={state.url} target="_blank" rel="noreferrer">
                  {state.url}
                </a>
                <label>
                  Code from the browser
                  <input
                    autoFocus
                    placeholder="paste it here"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
              </>
            )}
          </>
        )}

        {sent && state.phase !== 'done' && !error && (
          <p className="login-step muted">Code sent — waiting for the CLI to confirm…</p>
        )}
        {error && (
          <p className="modal-error">
            {error}
            {state.output && <code className="login-output">{state.output.slice(-600)}</code>}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={cancel}>
            {state.phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" disabled={state.phase === 'done' || !code.trim()}>
            Send code
          </button>
        </div>
      </form>
    </div>
  )
}
