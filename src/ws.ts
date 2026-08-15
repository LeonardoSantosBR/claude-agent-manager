const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '5174'

/**
 * Websocket vai direto no servidor Node, sem passar pelo proxy do vite.
 *
 * O proxy do vite estoura `EPIPE` quando o cliente fecha no meio de uma escrita
 * — e é exatamente o que acontece no dev: o servidor manda o scrollback inteiro
 * assim que alguém conecta, enquanto o StrictMode monta e desmonta o painel na
 * mesma tick. Falando direto, quem lida com o socket morto é o nosso servidor.
 */
export function wsUrl(path: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.hostname}:${SERVER_PORT}${path}`
}

/** Fecha sem abortar handshake em andamento (outra fonte de EPIPE). */
export function closeSocket(socket: WebSocket) {
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener('open', () => socket.close(), { once: true })
    return
  }
  if (socket.readyState === WebSocket.OPEN) socket.close()
}
