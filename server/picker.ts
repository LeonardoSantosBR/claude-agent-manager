import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Native folder picker. The browser can't hand back an absolute path
 * (`webkitdirectory` only gives the relative one), but the server runs on the
 * same machine — so it is the one opening the desktop dialog.
 */

const PICKERS = [
  { bin: 'zenity', args: (start: string) => ['--file-selection', '--directory', '--title=Choose the project folder', `--filename=${start}/`] },
  { bin: 'kdialog', args: (start: string) => ['--getexistingdirectory', start] },
]

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && existsSync(`${dir}/${bin}`)) return `${dir}/${bin}`
  }
  return null
}

const available = PICKERS.find((picker) => which(picker.bin)) ?? null

export const pickerName = available?.bin ?? null

/** One dialog at a time — two open zenitys confuse more than they help. */
let inFlight = false

export class PickerError extends Error {}

export function pickFolder(startIn?: string): Promise<string | null> {
  if (!available) {
    throw new PickerError(
      'no folder picker found on this system (install zenity or kdialog)',
    )
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new PickerError(
      'server has no graphical session — start the manager from your desktop terminal',
    )
  }
  if (inFlight) throw new PickerError('a picker is already open')

  const start = startIn && existsSync(startIn) ? startIn : homedir()
  inFlight = true

  return new Promise((resolve, reject) => {
    const child = execFile(
      available.bin,
      available.args(start),
      { timeout: 5 * 60_000 },
      (error, stdout) => {
        inFlight = false
        const path = stdout.trim()
        // zenity/kdialog exit with 1 when the user cancels.
        if (error && !path) return resolve(null)
        if (!path) return resolve(null)
        if (!existsSync(path)) {
          return reject(new PickerError(`folder not found: ${path}`))
        }
        resolve(path)
      },
    )
    child.on('error', (error) => {
      inFlight = false
      reject(new PickerError(error.message))
    })
  })
}
