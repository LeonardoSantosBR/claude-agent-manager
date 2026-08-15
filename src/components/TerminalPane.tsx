import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ClientMessage, ServerMessage } from '../../shared/types.ts'
import { closeSocket, wsUrl } from '../ws.ts'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#3c3c3c',
  foreground: '#e9e6e3',
  cursor: '#FF6C37',
  cursorAccent: '#3c3c3c',
  selectionBackground: 'rgba(255, 108, 55, 0.28)',
  black: '#3c3c3c',
  red: '#ff6c6c',
  green: '#a7d98a',
  yellow: '#f2c14e',
  blue: '#7db3e8',
  magenta: '#c99bf0',
  cyan: '#7fd3d0',
  white: '#e9e6e3',
  brightBlack: '#7a7a7a',
  brightRed: '#FF6C37',
  brightGreen: '#bde89c',
  brightYellow: '#ffd97d',
  brightBlue: '#9ecbff',
  brightMagenta: '#dcb3ff',
  brightCyan: '#a5e6e3',
  brightWhite: '#ffffff',
}

interface Props {
  sessionId: string
  active: boolean
}

/**
 * One terminal pane. Stays mounted even while hidden so switching sessions
 * doesn't lose the scrollback — only `display` changes.
 */
export function TerminalPane({ sessionId, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily:
        '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: 1.25,
      scrollback: 20000,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const socket = new WebSocket(wsUrl(`/ws?session=${sessionId}`))
    const send = (message: ClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }

    socket.onopen = () => {
      fit.fit()
      send({ type: 'resize', cols: term.cols, rows: term.rows })
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      if (message.type === 'data') term.write(message.data)
      if (message.type === 'exit') {
        term.write(
          `\r\n\x1b[38;2;255;108;55m── session ended (code ${message.code ?? 0}) ──\x1b[0m\r\n`,
        )
      }
    }

    const input = term.onData((data) => send({ type: 'input', data }))

    const observer = new ResizeObserver(() => {
      if (!host.offsetParent) return // hidden: measuring would give 0
      try {
        fit.fit()
        send({ type: 'resize', cols: term.cols, rows: term.rows })
      } catch {
        /* container has no size yet */
      }
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      input.dispose()
      socket.onmessage = null
      closeSocket(socket)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active])

  return <div className="terminal-host" ref={hostRef} style={{ display: active ? 'block' : 'none' }} />
}
