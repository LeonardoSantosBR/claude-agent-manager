import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Account, HistorySession } from '../shared/types.ts'

/** We only read the head of each .jsonl — files easily pass 500KB. */
const HEAD_BYTES = 128 * 1024
const MAX_PER_ACCOUNT = 300

interface Peek {
  cwd: string | null
  preview: string
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
        const text = (block as { text?: string }).text
        if (typeof text === 'string') return text
      }
    }
  }
  return null
}

/** Reads the file header looking for the cwd and the first human message. */
async function peek(file: string): Promise<Peek> {
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n')
    const result: Peek = { cwd: null, preview: '' }

    for (const line of lines) {
      if (!line.startsWith('{')) continue
      let record: Record<string, unknown>
      try {
        record = JSON.parse(line)
      } catch {
        continue // the buffer's last line usually comes truncated
      }
      if (!result.cwd && typeof record.cwd === 'string') result.cwd = record.cwd
      if (result.preview) continue
      if (record.type !== 'user' || record.isSidechain) continue
      const message = record.message as { content?: unknown } | undefined
      const text = extractText(message?.content)?.trim()
      // Skip system-reminders, command output and synthetic messages.
      if (!text || text.startsWith('<') || text.startsWith('Caveat:')) continue
      result.preview = text.replace(/\s+/g, ' ').slice(0, 140)
    }
    return result
  } finally {
    await handle.close()
  }
}

/**
 * Scans `<configDir>/projects/**\/<uuid>.jsonl`. That's the source of truth for
 * history — Claude Code itself writes there.
 */
export async function listHistory(
  accounts: Account[],
  openIds: Set<string>,
): Promise<HistorySession[]> {
  const out: HistorySession[] = []

  for (const account of accounts) {
    const root = join(account.configDir, 'projects')
    let dirs: string[]
    try {
      dirs = await readdir(root)
    } catch {
      continue // account not used yet
    }

    const files: { path: string; mtime: number }[] = []
    for (const dir of dirs) {
      let entries: string[]
      try {
        entries = await readdir(join(root, dir))
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const path = join(root, dir, entry)
        try {
          const info = await stat(path)
          if (info.size > 0) files.push({ path, mtime: info.mtimeMs })
        } catch {
          /* vanished mid-scan */
        }
      }
    }

    files.sort((a, b) => b.mtime - a.mtime)
    const recent = files.slice(0, MAX_PER_ACCOUNT)

    const peeked = await Promise.all(
      recent.map(async (file) => {
        try {
          return { file, info: await peek(file.path) }
        } catch {
          return { file, info: { cwd: null, preview: '' } as Peek }
        }
      }),
    )

    for (const { file, info } of peeked) {
      const id = basename(file.path, '.jsonl')
      const cwd = info.cwd ?? ''
      if (!cwd) continue
      out.push({
        id,
        cwd,
        project: basename(cwd),
        accountId: account.id,
        preview: info.preview,
        updatedAt: file.mtime,
        open: openIds.has(id),
      })
    }
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
