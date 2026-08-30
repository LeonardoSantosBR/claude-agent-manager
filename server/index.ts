import { createServer, type IncomingMessage } from 'node:http'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, Group, ServerMessage, SessionMeta } from '../shared/types.ts'
import { cancelLogin, loginState, logout, startLogin, submitCode } from './auth.ts'
import { CLAUDE_BIN, CONFIG_DIR, PORT, readAuth } from './config.ts'
import { listHistory } from './history.ts'
import { ImageError, saveImage } from './images.ts'
import { PickerError, pickerName, pickFolder } from './picker.ts'
import { SessionManager } from './sessions.ts'
import { flushState } from './store.ts'

const app = express()
// Pasted images arrive as base64 in the JSON body, which blows past the 100kb default.
app.use(express.json({ limit: '25mb' }))

const manager = new SessionManager()

// Read from disk on every call: the login can happen outside the manager (a
// `claude` in any terminal) and we want to notice it.
app.get('/api/auth', (_req, res) => {
  res.json(readAuth())
})

app.post('/api/auth/login', (_req, res) => {
  res.json(startLogin())
})

app.get('/api/auth/login', (_req, res) => {
  res.json(loginState())
})

app.post('/api/auth/login/code', (req, res) => {
  res.json(submitCode(String(req.body?.code ?? '')))
})

app.post('/api/auth/login/cancel', (_req, res) => {
  cancelLogin()
  res.json(loginState())
})

app.post('/api/auth/logout', (_req, res) => {
  res.json(logout())
})

app.get('/api/sessions', (_req, res) => {
  res.json(manager.list())
})

app.post('/api/sessions', (req, res) => {
  try {
    res.json(manager.create(req.body))
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
})

app.patch('/api/sessions/:id', (req, res) => {
  try {
    let meta: SessionMeta | undefined
    if (req.body.name !== undefined) {
      meta = manager.rename(req.params.id, String(req.body.name))
    }
    if (req.body.groupId !== undefined) {
      meta = manager.moveSession(req.params.id, req.body.groupId)
    }
    res.json(meta ?? manager.list().find((s) => s.id === req.params.id))
  } catch (error) {
    res.status(404).json({ error: (error as Error).message })
  }
})

app.get('/api/groups', (_req, res) => {
  res.json(manager.listGroups())
})

app.post('/api/groups', (req, res) => {
  try {
    res.json(manager.createGroup(String(req.body.name ?? ''), req.body.cwd))
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
})

app.patch('/api/groups/:id', (req, res) => {
  try {
    res.json(manager.updateGroup(req.params.id, req.body))
  } catch (error) {
    res.status(404).json({ error: (error as Error).message })
  }
})

app.delete('/api/groups/:id', (req, res) => {
  manager.removeGroup(req.params.id)
  res.json({ ok: true })
})

app.post('/api/sessions/:id/restart', (req, res) => {
  try {
    res.json(manager.restart(req.params.id))
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
})

app.post('/api/sessions/:id/stop', (req, res) => {
  manager.stop(req.params.id)
  res.json({ ok: true })
})

app.post('/api/sessions/:id/image', (req, res) => {
  const session = manager.get(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'session not found' })
    return
  }
  try {
    const path = saveImage(
      session.meta.cwd,
      String(req.body.mime ?? ''),
      String(req.body.data ?? ''),
    )
    res.json({ path })
  } catch (error) {
    const status = error instanceof ImageError ? 400 : 500
    res.status(status).json({ error: (error as Error).message })
  }
})

app.delete('/api/sessions/:id', (req, res) => {
  manager.remove(req.params.id)
  res.json({ ok: true })
})

app.post('/api/pick-folder', async (req, res) => {
  try {
    const path = await pickFolder(req.body?.startIn)
    res.json({ path })
  } catch (error) {
    const status = error instanceof PickerError ? 409 : 500
    res.status(status).json({ error: (error as Error).message })
  }
})

app.get('/api/history', async (_req, res) => {
  const openIds = new Set(manager.list().map((s) => s.id))
  res.json(await listHistory(CONFIG_DIR, openIds))
})

const server = createServer(app)
const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (request, socket, head) => {
  // Clients vanishing mid-handshake is routine (StrictMode, HMR, reload) —
  // without this handler it becomes an unhandled exception and kills the server.
  socket.on('error', () => {})
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (url.pathname !== '/ws') return socket.destroy()
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, url.searchParams)
  })
})

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message))
}

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, params: URLSearchParams) => {
  ws.on('error', () => {}) // same: EPIPE/ECONNRESET from a client that closed
  const sessionId = params.get('session')

  // Event channel: pushes the session list whenever something changes.
  if (!sessionId) {
    const push = (state: { sessions: SessionMeta[]; groups: Group[] }) =>
      send(ws, { type: 'state', ...state })
    manager.on('state', push)
    send(ws, { type: 'state', sessions: manager.list(), groups: manager.listGroups() })
    ws.on('close', () => manager.off('state', push))
    return
  }

  // Before the replay, so the PTY is already at the pane's size when it repaints.
  const cols = Number(params.get('cols'))
  const rows = Number(params.get('rows'))
  if (cols > 0 && rows > 0) manager.resize(sessionId, cols, rows)

  // The repaint that follows the nudge is what puts the cursor back where the
  // PTY has it; until then the pane must not send keystrokes (see 'synced').
  let awaitingRepaint = manager.get(sessionId)?.proc != null
  const sync = () => {
    if (!awaitingRepaint) return
    awaitingRepaint = false
    send(ws, { type: 'synced' })
  }

  // attach() hands over the replay synchronously — that's not the repaint.
  let replaying = true
  let detach: (() => void) | null = null
  try {
    detach = manager.attach(sessionId, (data) => {
      send(ws, { type: 'data', data })
      if (!replaying) sync()
    })
    replaying = false
  } catch {
    ws.close(4004, 'session not found')
    return
  }
  // A stopped session has nothing to repaint, and a live one that stays silent
  // shouldn't hold the keyboard hostage either.
  if (!awaitingRepaint) send(ws, { type: 'synced' })
  const syncFallback = setTimeout(sync, 1500)

  const onExit = (id: string, code: number | null) => {
    if (id === sessionId) send(ws, { type: 'exit', code })
  }
  manager.on('exit', onExit)

  ws.on('message', (raw) => {
    let message: ClientMessage
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.type === 'input') manager.write(sessionId, message.data)
    if (message.type === 'resize') manager.resize(sessionId, message.cols, message.rows)
  })

  ws.on('close', () => {
    clearTimeout(syncFallback)
    detach?.()
    manager.off('exit', onExit)
  })

  // After the replay, force the TUI to redraw over the resent buffer.
  setTimeout(() => manager.nudge(sessionId), 120)
})

// Ctrl+C on the dev server is the normal way this process dies, so the last
// screen and the last metadata edit have to make it to disk here.
let shuttingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    manager.shutdown()
    cancelLogin()
    flushState()
    process.exit(0)
  })
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[agent-manager] port ${PORT} is busy — is another server already running?\n` +
        `  lsof -i :${PORT}   (or change it with PORT=xxxx)`,
    )
    process.exit(1)
  }
  throw error
})

server.listen(PORT, () => {
  console.log(
    `[agent-manager] http://localhost:${PORT}  claude=${CLAUDE_BIN}  ` +
      `folder picker=${pickerName ?? 'unavailable'}`,
  )
  const auth = readAuth()
  const who = auth.identity?.email ?? 'unknown account'
  console.log(`  ${auth.configDir}  [${auth.loggedIn ? who : 'NOT LOGGED IN'}]`)
})
