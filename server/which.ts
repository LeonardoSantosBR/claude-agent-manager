import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Portable `which`. Windows ships no `which` binary, and the things we hand the
 * resolved path to — `pty.spawn` and `execFile` — go straight to CreateProcess,
 * which does no `PATHEXT` lookup of its own. So a bare "claude" fails there even
 * though `claude.exe` sits right on the PATH.
 */
export function which(bin: string): string | null {
  // The empty extension first: an argument that already carries one (or a
  // Unix binary) must win over "claude" + ".EXE".
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
      : ['']

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/**
 * Matches what the `which` binary accepts, so the Unix result is unchanged: a
 * regular file carrying the execute bit. On Windows the execute bit doesn't
 * exist and PATHEXT already decides what is runnable, so existence is enough.
 */
function isExecutable(path: string): boolean {
  if (process.platform === 'win32') return existsSync(path)
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}
