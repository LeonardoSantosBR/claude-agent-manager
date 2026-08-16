import { useEffect, useState } from 'react'
import type { AuthStatus, CreateSessionBody, Group } from '../../shared/types.ts'
import { api } from '../api.ts'

const NEW_GROUP = '__new__'

interface Props {
  auth: AuthStatus
  groups: Group[]
  defaultGroupId: string | null
  knownPaths: string[]
  onClose: () => void
  onCreate: (body: CreateSessionBody) => Promise<void>
}

export function NewSessionModal(props: Props) {
  const initialGroup = props.groups.find((g) => g.id === props.defaultGroupId)
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(initialGroup?.cwd ?? '')
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
        groupId: groupId && groupId !== NEW_GROUP ? groupId : null,
        newGroupName: groupId === NEW_GROUP ? newGroupName : undefined,
      })
      props.onClose()
    } catch (failure) {
      setError((failure as Error).message)
      setBusy(false)
    }
  }

  // configDir only ever comes from the server, so an empty one means we never
  // reached it — creating a session would fail anyway.
  const offline = !props.auth.configDir

  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New session</h2>

        <label>
          Name
          <input
            autoFocus
            placeholder="e.g. checkout refactor"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label>
          Group
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
            Group Name
            <input
              required
              placeholder="e.g. curiosity"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
        )}

        <label>
          Project Folder
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

        {!props.auth.loggedIn && (
          <p className="modal-warn">
            Not logged in yet — the agent will open on Claude Code's authentication
            screen. Use <strong>Log in</strong> at the bottom of the sidebar first.
          </p>
        )}
        {offline && (
          <p className="modal-error">
            Can't reach the server. Check the terminal running <code>npm run dev</code>.
          </p>
        )}
        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || offline || !cwd.trim()}>
            {busy ? 'Opening…' : 'Open session'}
          </button>
        </div>
      </form>
    </div>
  )
}
