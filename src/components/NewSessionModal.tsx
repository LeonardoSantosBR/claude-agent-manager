import { useEffect, useState } from 'react'
import type { Account, CreateSessionBody } from '../../shared/types.ts'
import { api } from '../api.ts'

interface Props {
  accounts: Account[]
  defaultAccountId: string
  /** pastas já vistas no histórico, pra autocompletar. */
  knownPaths: string[]
  onClose: () => void
  onCreate: (body: CreateSessionBody) => Promise<void>
}

export function NewSessionModal(props: Props) {
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(props.knownPaths[0] ?? '')
  const [accountId, setAccountId] = useState(props.defaultAccountId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  // O diálogo é aberto pelo servidor, no desktop — a janela pode aparecer atrás
  // do browser, então o botão fica em estado de espera até responderem.
  const browse = async () => {
    setPicking(true)
    setError(null)
    try {
      const { path } = await api.pickFolder(cwd.trim() || undefined)
      if (path) setCwd(path)
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      setPicking(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const account = props.accounts.find((a) => a.id === accountId)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await props.onCreate({ name, cwd, accountId })
      props.onClose()
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Nova sessão</h2>

        <label>
          Nome
          <input
            autoFocus
            placeholder="ex: refactor do checkout"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          Pasta do projeto
          <span className="path-field">
            <input
              required
              list="known-paths"
              placeholder="/home/você/projeto"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
            />
            <button
              type="button"
              className="browse"
              onClick={() => void browse()}
              disabled={picking}
              title="Abrir o seletor de pastas"
            >
              {picking ? '…' : 'Procurar'}
            </button>
          </span>
          <datalist id="known-paths">
            {props.knownPaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        </label>

        <label>
          Conta
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            {props.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.loggedIn ? '' : ' (sem login)'}
              </option>
            ))}
          </select>
        </label>

        {account && !account.loggedIn && (
          <p className="modal-warn">
            Essa conta ainda não tem login — o agente vai abrir na tela de
            autenticação do Claude Code.
          </p>
        )}
        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={props.onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={busy || !cwd.trim()}>
            {busy ? 'Abrindo…' : 'Abrir sessão'}
          </button>
        </div>
      </form>
    </div>
  )
}
