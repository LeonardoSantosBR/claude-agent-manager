import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

/**
 * Seletor de pasta nativo. O browser não consegue devolver caminho absoluto
 * (`webkitdirectory` só dá o relativo), mas o servidor roda na mesma máquina —
 * então quem abre o diálogo do desktop é ele.
 */

const PICKERS = [
  { bin: 'zenity', args: (start: string) => ['--file-selection', '--directory', '--title=Escolha a pasta do projeto', `--filename=${start}/`] },
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

/** Um diálogo por vez — dois zenitys abertos confundem mais do que ajudam. */
let inFlight = false

export class PickerError extends Error {}

export function pickFolder(startIn?: string): Promise<string | null> {
  if (!available) {
    throw new PickerError(
      'nenhum seletor de pasta encontrado no sistema (instale zenity ou kdialog)',
    )
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new PickerError(
      'servidor sem sessão gráfica — inicie o manager pelo terminal do seu desktop',
    )
  }
  if (inFlight) throw new PickerError('já tem um seletor aberto')

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
        // zenity/kdialog saem com 1 quando o usuário cancela.
        if (error && !path) return resolve(null)
        if (!path) return resolve(null)
        if (!existsSync(path)) {
          return reject(new PickerError(`pasta não encontrada: ${path}`))
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
