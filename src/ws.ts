const SERVER_PORT = import.meta.env.VITE_SERVER_PORT ?? '5174'

/**
 * Websockets talk straight to the Node server, skipping vite's proxy.
 *
 * Vite's proxy throws `EPIPE` when the client closes mid-write — exactly what
 * happens in dev: the server dumps the whole scrollback as soon as someone
 * connects, while StrictMode mounts and unmounts the pane in the same tick.
 * Talking directly, it's our server that deals with the dead socket.
 */
export function wsUrl(path: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.hostname}:${SERVER_PORT}${path}`
}

/** Closes without aborting an in-flight handshake (another EPIPE source). */
export function closeSocket(socket: WebSocket) {
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener('open', () => socket.close(), { once: true })
    return
  }
  if (socket.readyState === WebSocket.OPEN) socket.close()
}
