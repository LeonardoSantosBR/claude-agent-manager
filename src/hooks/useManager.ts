import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Account,
  Group,
  HistorySession,
  ServerMessage,
  SessionMeta,
} from '../../shared/types.ts'
import { api } from '../api.ts'
import { closeSocket, wsUrl } from '../ws.ts'

/**
 * Global manager state. Sessions and groups arrive over the websocket (the
 * server pushes on every change); accounts and history are fetched over HTTP —
 * and refetched whenever the websocket (re)connects, otherwise a server that was
 * down at load time would leave those lists empty forever.
 */
export function useManager() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
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

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await api.accounts())
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
        Promise.all([api.accounts(), api.history()])
          .then(([nextAccounts, nextHistory]) => {
            if (closed) return
            setAccounts(nextAccounts)
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

  return { sessions, groups, accounts, history, connected, refreshHistory, refreshAccounts }
}
