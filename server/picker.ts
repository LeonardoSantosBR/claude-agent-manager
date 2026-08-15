import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { which } from './which.ts'

/**
 * Native folder picker. The browser can't hand back an absolute path
 * (`webkitdirectory` only gives the relative one), but the server runs on the
 * same machine — so it is the one opening the desktop dialog.
 *
 * Each platform gets its own dialog: PowerShell/WinForms on Windows,
 * osascript on macOS, zenity or kdialog elsewhere.
 */

type Picker = {
  /** Shown in logs and in the "unavailable" message. */
  name: string
  bin: string
  args: (start: string) => string[]
}

/** WinForms dialog, driven by a base64 script so paths never hit the shell. */
function windowsPicker(): Picker | null {
  const bin =
    which('powershell') ??
    join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  if (!existsSync(bin)) return null

  return {
    name: 'powershell',
    bin,
    args: (start) => {
      // The owner form is minimised rather than never shown: a dialog with an
      // unrealised owner opens behind the browser and looks like nothing happened.
      const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$owner = New-Object System.Windows.Forms.Form
$owner.ShowInTaskbar = $false
$owner.WindowState = 'Minimized'
$owner.TopMost = $true
$owner.Show()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose the project folder'
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = '${start.replace(/'/g, "''")}'
$result = $dialog.ShowDialog($owner)
$owner.Close()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`
      return [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        // Hides the host console only. Do NOT use execFile's `windowsHide`
        // instead — that one hides the dialog along with it.
        '-WindowStyle',
        'Hidden',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ]
    },
  }
}

function macPicker(): Picker | null {
  const bin = which('osascript') ?? '/usr/bin/osascript'
  if (!existsSync(bin)) return null

  return {
    name: 'osascript',
    bin,
    args: (start) => {
      const quoted = start.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      return [
        '-e',
        `POSIX path of (choose folder with prompt "Choose the project folder" default location POSIX file "${quoted}")`,
      ]
    },
  }
}

function linuxPicker(): Picker | null {
  const candidates: Picker[] = [
    {
      name: 'zenity',
      bin: 'zenity',
      args: (start) => [
        '--file-selection',
        '--directory',
        '--title=Choose the project folder',
        `--filename=${start}/`,
      ],
    },
    { name: 'kdialog', bin: 'kdialog', args: (start) => ['--getexistingdirectory', start] },
  ]
  for (const picker of candidates) {
    const bin = which(picker.bin)
    if (bin) return { ...picker, bin }
  }
  return null
}

function detect(): Picker | null {
  if (process.platform === 'win32') return windowsPicker()
  if (process.platform === 'darwin') return macPicker()
  return linuxPicker()
}

const available = detect()

export const pickerName = available?.name ?? null

/**
 * One dialog at a time — two open dialogs confuse more than they help. A new
 * request supersedes the old one instead of failing: if the previous dialog got
 * lost behind a window, refusing to open another leaves no way out but waiting
 * for the five-minute timeout.
 */
let inFlight: { child: ChildProcess; id: number } | null = null
let nextPickerId = 1

export class PickerError extends Error {}

function missingPickerMessage(): string {
  if (process.platform === 'win32') return 'powershell not found on this system'
  if (process.platform === 'darwin') return 'osascript not found on this system'
  return 'no folder picker found on this system (install zenity or kdialog)'
}

export function pickFolder(startIn?: string): Promise<string | null> {
  if (!available) throw new PickerError(missingPickerMessage())
  // Only X11/Wayland can be headless in a way we can detect up front;
  // Windows and macOS always have a session behind the server process.
  if (
    process.platform !== 'win32' &&
    process.platform !== 'darwin' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY
  ) {
    throw new PickerError(
      'server has no graphical session — start the manager from your desktop terminal',
    )
  }
  inFlight?.child.kill()

  const start = startIn && existsSync(startIn) ? startIn : homedir()
  const id = nextPickerId++

  return new Promise((resolve, reject) => {
    const done = () => {
      if (inFlight?.id === id) inFlight = null
    }
    const child = execFile(
      available.bin,
      available.args(start),
      { timeout: 5 * 60_000 },
      (error, stdout) => {
        done()
        const path = stdout.trim()
        // Every backend exits non-zero (or prints nothing) when the user cancels.
        if (error && !path) return resolve(null)
        if (!path) return resolve(null)
        if (!existsSync(path)) {
          return reject(new PickerError(`folder not found: ${path}`))
        }
        resolve(path)
      },
    )
    child.on('error', (error) => {
      done()
      reject(new PickerError(error.message))
    })
    inFlight = { child, id }
  })
}
