import { createServer, type IncomingMessage } from 'node:http'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import type { ClientMessage, ServerMessage, SessionMeta } from '../shared/types.ts'
import { CLAUDE_BIN, loadAccounts, PORT } from './config.ts'
import { listHistory } from './history.ts'
import { PickerError, pickerName, pickFolder } from './picker.ts'
import { SessionManager } from './sessions.ts'

const app = express()
app.use(express.json())

let accounts = loadAccounts()
const manager = new SessionManager(() => accounts)

app.get('/api/accounts', (_req, res) => {
  accounts = loadAccounts() // relê pra pegar login feito depois do boot
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
    res.json(manager.rename(req.params.id, String(req.body.name ?? '')))
  } catch (error) {
    res.status(404).json({ error: (error as Error).message })
  }
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
  // Cliente sumindo no meio do handshake é rotina (StrictMode, HMR, reload) —
  // sem esse handler vira exceção não tratada e derruba o servidor.
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
  ws.on('error', () => {}) // idem: EPIPE/ECONNRESET de cliente que fechou
  const sessionId = params.get('session')

  // Canal de eventos: só empurra a lista de sessões quando algo muda.
  if (!sessionId) {
    const push = (sessions: SessionMeta[]) => send(ws, { type: 'sessions', sessions })
    manager.on('sessions', push)
    send(ws, { type: 'sessions', sessions: manager.list() })
    ws.on('close', () => manager.off('sessions', push))
    return
  }

  let detach: (() => void) | null = null
  try {
    detach = manager.attach(sessionId, (data) => send(ws, { type: 'data', data }))
  } catch {
    ws.close(4004, 'sessão não encontrada')
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

  // Depois do replay, força a TUI a redesenhar por cima do buffer reenviado.
  setTimeout(() => manager.nudge(sessionId), 120)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[agent-manager] porta ${PORT} ocupada — já tem um servidor rodando?\n` +
        `  lsof -i :${PORT}   (ou mude com PORT=xxxx)`,
    )
    process.exit(1)
  }
  throw error
})

server.listen(PORT, () => {
  console.log(
    `[agent-manager] http://localhost:${PORT}  claude=${CLAUDE_BIN}  ` +
      `seletor de pasta=${pickerName ?? 'indisponível'}`,
  )
  for (const account of accounts) {
    const state = account.loggedIn ? 'ok' : 'SEM LOGIN'
    console.log(`  conta ${account.id.padEnd(9)} ${account.configDir}  [${state}]`)
  }
})
