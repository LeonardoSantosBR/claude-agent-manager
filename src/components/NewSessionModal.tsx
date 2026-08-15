import { useEffect, useState } from 'react'
import type { Account, CreateSessionBody, Group } from '../../shared/types.ts'
import { api } from '../api.ts'

const NEW_GROUP = '__new__'

interface Props {
  accounts: Account[]
  groups: Group[]
  defaultAccountId: string
  defaultGroupId: string | null
  knownPaths: string[]
  onClose: () => void
  onCreate: (body: CreateSessionBody) => Promise<void>
}

export function NewSessionModal(props: Props) {
  const initialGroup = props.groups.find((g) => g.id === props.defaultGroupId)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(initialGroup?.cwd ?? '')
  const [accountId, setAccountId] = useState(props.defaultAccountId)
  const [groupId, setGroupId] = useState<string>(props.defaultGroupId ?? '')
  const [newGroupName, setNewGroupName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props])

  const account = props.accounts.find((a) => a.id === accountId)

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

  const pickGroup = (value: string) => {
    setGroupId(value)
    const group = props.groups.find((g) => g.id === value)
    if (group?.cwd && !cwd.trim()) setCwd(group.cwd)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await props.onCreate({
        name,
        cwd,
        accountId,
        groupId: groupId && groupId !== NEW_GROUP ? groupId : null,
        newGroupName: groupId === NEW_GROUP ? newGroupName : undefined,
      })
      props.onClose()
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  const offline = props.accounts.length === 0

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>new session</h2>

        <label>
          name
          <input
            autoFocus
            placeholder="e.g. checkout refactor"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          group
          <select value={groupId} onChange={(event) => pickGroup(event.target.value)}>
            <option value="">— no group —</option>
            {props.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
            <option value={NEW_GROUP}>+ new group…</option>
          </select>
        </label>

        {groupId === NEW_GROUP && (
          <label>
            group name
            <input
              required
              placeholder="e.g. curiosity"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
        )}

        <label>
          project folder
          <span className="path-field">
            <input
              required
              list="known-paths"
              placeholder="/home/you/project"
              value={cwd}
              onChange={(event) => setCwd(event.target.value)}
            />
            <button
              type="button"
              className="browse"
              onClick={() => void browse()}
              disabled={picking}
              title="Open the folder picker"
            >
              {picking ? '…' : 'Browse'}
            </button>
          </span>
          <datalist id="known-paths">
            {props.knownPaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
        </label>

        <label>
          account
          <select
            value={accountId}
            disabled={offline}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {props.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
                {item.loggedIn ? '' : ' (not logged in)'}
              </option>
            ))}
          </select>
        </label>

        {offline && (
          <p className="modal-error">
            Can't reach the server, so I don't know which accounts exist. Check the
            terminal running <code>npm run dev</code>.
          </p>
        )}
        {account && !account.loggedIn && (
          <p className="modal-warn">
            This account isn't logged in yet — the agent will open on Claude Code's
            authentication screen.
          </p>
        )}
        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || offline || !cwd.trim()}>
            {busy ? 'opening…' : 'open session'}
          </button>
        </div>
      </form>
    </div>
  )
}
