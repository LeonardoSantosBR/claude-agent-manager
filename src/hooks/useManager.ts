import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthStatus,
  Group,
  HistorySession,
  ServerMessage,
  SessionMeta,
} from '../../shared/types.ts'
import { api } from '../api.ts'
import { closeSocket, wsUrl } from '../ws.ts'

const LOGGED_OUT: AuthStatus = { loggedIn: false, identity: null, configDir: '' }

/**
 * Global manager state. Sessions and groups arrive over the websocket (the
 * server pushes on every change); the login status and the history are fetched
 * over HTTP — and refetched whenever the websocket (re)connects, otherwise a
 * server that was down at load time would leave those empty forever.
 */
export function useManager() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [auth, setAuth] = useState<AuthStatus>(LOGGED_OUT)
  const [history, setHistory] = useState<HistorySession[]>([])
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.history())
    } catch {
      /* server is down — the websocket reconnect will retry this */
    }
  }, [])

  const refreshAuth = useCallback(async () => {
    try {
      setAuth(await api.auth())
    } catch {
      /* same */
    }
  }, [])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      if (closed) return
      const socket = new WebSocket(wsUrl('/ws'))
      socketRef.current = socket

      socket.onopen = () => {
        setConnected(true)
        Promise.all([api.auth(), api.history()])
          .then(([nextAuth, nextHistory]) => {
            if (closed) return
            setAuth(nextAuth)
            setHistory(nextHistory)
          })
          .catch(() => {
            /* REST failed but the ws is up: the next reconnect retries */
          })
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage
        if (message.type === 'state') {
          setSessions(message.sessions)
          setGroups(message.groups)
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) retry = setTimeout(connect, 1500)
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      if (socketRef.current) closeSocket(socketRef.current)
    }
  }, [])

  return { sessions, groups, auth, history, connected, refreshHistory, refreshAuth }
}
