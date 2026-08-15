import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = 'http://localhost:5174'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Sem strictPort o vite pula pra 5174 quando a 5173 está ocupada — e rouba
    // a porta da API, o que dá app em branco com erro de proxy.
    strictPort: true,
    // Só o REST passa por aqui. Os websockets falam direto com o servidor
    // (ver src/ws.ts) — o proxy do vite não aguenta o volume do terminal.
    proxy: { '/api': API },
  },
})
