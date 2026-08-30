import { useCallback, useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { ClientMessage, ServerMessage } from '../../shared/types.ts'
import { api } from '../api.ts'
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
 * Claude's TUI draws the input caret as `❯`. Blanking it keeps the pane's
 * prompt clean — a space, not an empty string, so every column after it stays
 * where the PTY put it.
 */
function hidePromptArrow(data: string) {
  return data.replaceAll('❯', ' ')
}

/**
 * Browsers disagree on where a clipboard image lands: Chrome fills `items`,
 * Firefox and some Linux builds only fill `files`. Read both.
 */
function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  const found = new Map<string, File>()
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) found.set(`${file.name}:${file.size}:${file.lastModified}`, file)
  }
  for (const file of Array.from(data.files ?? [])) {
    if (!file.type.startsWith('image/')) continue
    found.set(`${file.name}:${file.size}:${file.lastModified}`, file)
  }
  return [...found.values()]
}

/** Strips the `data:image/png;base64,` prefix a FileReader result carries. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Windows paths carry backslashes and spaces — quote them for the shell/TUI. */
function quotePath(path: string) {
  return /[\s"']/.test(path) ? `"${path.replaceAll('"', '\\"')}"` : path
}


/**
 * One terminal pane. Stays mounted even while hidden so switching sessions
 * doesn't lose the scrollback — only `display` changes.
 */
export function TerminalPane({ sessionId, active }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<((data: string) => void) | null>(null)
  // The paste listener lives on `window` (see below) and every mounted pane
  // installs one, so each needs to know whether it is the visible one.
  const activeRef = useRef(active)

  /**
   * Uploads pasted/dropped images and types their paths into the session.
   * The path goes in wrapped in the bracketed-paste escapes: Claude's TUI
   * treats a plain burst of keystrokes as typing and drops characters, but
   * handles a bracketed paste atomically.
   */
  const sendImages = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        try {
          const { path } = await api.uploadImage(sessionId, file.type, await toBase64(file))
          sendRef.current?.(`\x1b[200~${quotePath(path)} \x1b[201~`)
        } catch (error) {
          console.error('[image] upload failed', error)
        }
      }
    },
    [sessionId],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 10,
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
    try {
      fit.fit()
    } catch {
      /* container has no size yet — onopen fits again */
    }
    termRef.current = term
    fitRef.current = fit

    // The size travels in the URL so the server can resize the PTY *before*
    // replaying: bytes drawn at another width land with the cursor a column off,
    // and the next keystroke shows up beside the prompt instead of inside it.
    const socket = new WebSocket(
      wsUrl(`/ws?session=${sessionId}&cols=${term.cols}&rows=${term.rows}`),
    )
    const send = (message: ClientMessage) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    sendRef.current = (data: string) => send({ type: 'input', data })

    socket.onopen = () => {
      fit.fit()
      send({ type: 'resize', cols: term.cols, rows: term.rows })
    }
    // Claude echoes a typed character as a bare byte at the current cursor, so
    // anything typed before the post-attach repaint lands beside the prompt.
    // Keystrokes wait here until the server says the screen is in sync.
    let synced = false
    const held: string[] = []

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      if (message.type === 'data') term.write(hidePromptArrow(message.data))
      if (message.type === 'synced') {
        synced = true
        for (const data of held.splice(0)) send({ type: 'input', data })
      }
      if (message.type === 'exit') {
        term.write(
          `\r\n\x1b[38;2;255;108;55m── session ended (code ${message.code ?? 0}) ──\x1b[0m\r\n`,
        )
      }
    }

    const input = term.onData((data) => {
      if (synced) send({ type: 'input', data })
      else held.push(data)
    })

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
      sendRef.current = null
    }
  }, [sessionId])

  // xterm.js swallows `paste` on its own hidden textarea, so the listener goes
  // on `window` — otherwise the event never reaches us.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!activeRef.current) return
      const files = clipboardImages(event.clipboardData)
      if (files.length === 0) return // plain text: let xterm handle it
      event.preventDefault()
      void sendImages(files)
    }
    const onDrop = (event: DragEvent) => {
      if (!activeRef.current) return
      const files = clipboardImages(event.dataTransfer)
      if (files.length === 0) return
      event.preventDefault()
      void sendImages(files)
    }
    // Without this the browser navigates away to the dropped file.
    const onDragOver = (event: DragEvent) => {
      if (activeRef.current) event.preventDefault()
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [sendImages])

  useEffect(() => {
    activeRef.current = active
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
