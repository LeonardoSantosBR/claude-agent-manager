import { createServer, type IncomingMessage } from 'node:http'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, Group, ServerMessage, SessionMeta } from '../shared/types.ts'
import { CLAUDE_BIN, loadAccounts, PORT } from './config.ts'
import { listHistory } from './history.ts'
import { PickerError, pickerName, pickFolder } from './picker.ts'
import { SessionManager } from './sessions.ts'
import { flushState } from './store.ts'

const app = express()
app.use(express.json())

let accounts = loadAccounts()
const manager = new SessionManager(() => accounts)

app.get('/api/accounts', (_req, res) => {
  accounts = loadAccounts() // re-read to pick up a login done after boot
  res.json(accounts)
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
  res.json(await listHistory(accounts, openIds))
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

  let detach: (() => void) | null = null
  try {
    detach = manager.attach(sessionId, (data) => send(ws, { type: 'data', data }))
  } catch {
    ws.close(4004, 'session not found')
    return
  }

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
  for (const account of accounts) {
    const state = account.loggedIn ? 'ok' : 'NOT LOGGED IN'
    console.log(`  account ${account.id.padEnd(9)} ${account.configDir}  [${state}]`)
  }
})
