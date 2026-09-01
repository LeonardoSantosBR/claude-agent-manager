import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Server-side tests only — the UI is a terminal in a websocket, which is worth
 * far less under a fake DOM than it is opened in a browser.
 *
 * config.ts freezes STATE_DIR at import time, so the override has to be in the
 * environment before any test file loads it. Pointing it at a temp dir is what
 * keeps a test run from touching the real ~/.config/claude-agent-manager.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      AGENT_MANAGER_STATE_DIR: join(tmpdir(), 'claude-agent-manager-tests', 'state'),
    },
  },
})
