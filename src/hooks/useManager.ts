import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account, HistorySession, ServerMessage, SessionMeta } from '../../shared/types.ts'
import { api } from '../api.ts'
import { closeSocket, wsUrl } from '../ws.ts'

/**
 * Estado global do manager. A lista de sessões chega por websocket (o servidor
 * empurra a cada mudança); contas e histórico são buscados sob demanda.
 */
export function useManager() {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [history, setHistory] = useState<HistorySession[]>([])
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.history())
    } catch {
      /* servidor ainda subindo */
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      setAccounts(await api.accounts())
    } catch {
      /* idem */
    }
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([api.accounts(), api.history()])
      .then(([nextAccounts, nextHistory]) => {
        if (!alive) return
        setAccounts(nextAccounts)
        setHistory(nextHistory)
      })
      .catch(() => {
        /* servidor ainda subindo — o websocket reconecta e o usuário pode
           recarregar; não vale derrubar a UI por isso. */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>

    const connect = () => {
      if (closed) return
      const socket = new WebSocket(wsUrl('/ws'))
      socketRef.current = socket

      socket.onopen = () => setConnected(true)
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data as string) as ServerMessage
        if (message.type === 'sessions') setSessions(message.sessions)
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

  return { sessions, accounts, history, connected, refreshHistory, refreshAccounts }
}
