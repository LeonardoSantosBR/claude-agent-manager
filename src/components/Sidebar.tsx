import { useMemo, useState } from 'react'
import type { Account, Group, HistorySession, SessionMeta } from '../../shared/types.ts'
import { timeAgo } from '../utils.ts'

interface Props {
  sessions: SessionMeta[]
  groups: Group[]
  accounts: Account[]
  history: HistorySession[]
  activeId: string | null
  activeAccountId: string
  connected: boolean
  onSelect: (id: string) => void
  onNew: (groupId: string | null) => void
  onResume: (entry: HistorySession) => void
  onRename: (id: string, name: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onRemove: (id: string) => void
  onAccountChange: (id: string) => void
  onCreateGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onRemoveGroup: (id: string) => void
  onToggleGroup: (id: string, collapsed: boolean) => void
  onMoveSession: (id: string, groupId: string | null) => void
}

const DRAG_TYPE = 'application/x-session-id'

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<'live' | 'history'>('live')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const activeAccount = props.accounts.find((a) => a.id === props.activeAccountId)
  const needle = filter.trim().toLowerCase()

  const matches = (session: SessionMeta) =>
    !needle ||
    session.name.toLowerCase().includes(needle) ||
    session.project.toLowerCase().includes(needle)

  const byGroup = useMemo(() => {
    const map = new Map<string, SessionMeta[]>()
    for (const session of props.sessions.filter(matches)) {
      const key = session.groupId ?? ''
      map.set(key, [...(map.get(key) ?? []), session])
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessions, needle])

  const ungrouped = byGroup.get('') ?? []

  const historyGroups = useMemo(() => {
    const open = new Set(props.sessions.map((s) => s.id))
    const filtered = props.history.filter(
      (entry) =>
        !open.has(entry.id) &&
        (!needle ||
          entry.project.toLowerCase().includes(needle) ||
          entry.preview.toLowerCase().includes(needle)),
    )
    const map = new Map<string, HistorySession[]>()
    for (const entry of filtered) {
      map.set(entry.project, [...(map.get(entry.project) ?? []), entry])
    }
    return [...map.entries()]
  }, [props.history, props.sessions, needle])

  const commitRename = (id: string) => {
    props.onRename(id, draft)
    setEditing(null)
  }

  const commitGroupRename = (id: string) => {
    props.onRenameGroup(id, draft)
    setEditing(null)
  }

  const dropProps = (groupId: string | null) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      setDropTarget(groupId ?? '')
    },
    onDragLeave: () => setDropTarget(null),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      const sessionId = event.dataTransfer.getData(DRAG_TYPE)
      setDropTarget(null)
      if (sessionId) props.onMoveSession(sessionId, groupId)
    },
  })

  const renderSession = (session: SessionMeta) => {
    const account = props.accounts.find((a) => a.id === session.accountId)
    return (
      <div
        key={session.id}
        className={`row ${session.id === props.activeId ? 'active' : ''}`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, session.id)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onClick={() => props.onSelect(session.id)}
      >
        <span
          className={`status ${session.status}`}
          title={session.status === 'running' ? 'running' : 'stopped'}
        />
        {editing === session.id ? (
          <input
            className="rename"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commitRename(session.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename(session.id)
              if (event.key === 'Escape') setEditing(null)
            }}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span
            className="row-name"
            title={session.cwd}
            onDoubleClick={(event) => {
              event.stopPropagation()
              setDraft(session.name)
              setEditing(session.id)
            }}
          >
            {session.name}
          </span>
        )}
        <span
          className="account-tag"
          style={{ background: account?.color ?? '#777' }}
          title={account?.label}
        />
        <span className="row-actions">
          {session.status === 'running' ? (
            <button
              type="button"
              title="Stop"
              onClick={(event) => {
                event.stopPropagation()
                props.onStop(session.id)
              }}
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              title="Resume"
              onClick={(event) => {
                event.stopPropagation()
                props.onRestart(session.id)
              }}
            >
              ▸
            </button>
          )}
          <button
            type="button"
            title="Remove from list"
            onClick={(event) => {
              event.stopPropagation()
              props.onRemove(session.id)
            }}
          >
            ✕
          </button>
        </span>
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">
          <span className={`link-dot ${props.connected ? 'on' : 'off'}`} />
          Agent Manager
        </div>

        <div className="accounts" role="group" aria-label="Active account">
          {props.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`account-pill ${account.id === props.activeAccountId ? 'selected' : ''}`}
              style={{ '--pill': account.color } as React.CSSProperties}
              onClick={() => props.onAccountChange(account.id)}
              title={account.configDir}
            >
              <span className="pill-dot" />
              {account.label}
              {!account.loggedIn && <span className="pill-warn">!</span>}
            </button>
          ))}
        </div>

        {activeAccount && !activeAccount.loggedIn && (
          <p className="login-hint">
            Not logged in on this account. Run once in a terminal:
            <code>CLAUDE_CONFIG_DIR={activeAccount.configDir} claude</code>then{' '}
            <code>/login</code>.
          </p>
        )}
      </header>

      <div className="head-actions">
        <button type="button" className="new-session" onClick={() => props.onNew(null)}>
          + new session
        </button>
        <button
          type="button"
          className="new-group"
          title="Create group"
          onClick={() => {
            setNewGroup('')
            setTab('live')
          }}
        >
          + Group
        </button>
      </div>

      <input
        className="search"
        placeholder="Filter sessions…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <nav className="tabs">
        <button type="button" className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>
          Sessions <span className="count">{props.sessions.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'history' ? 'on' : ''}
          onClick={() => setTab('history')}
        >
          History
        </button>
      </nav>

      <div className="list">
        {tab === 'live' && (
          <>
            {newGroup !== null && (
              <input
                className="rename new-group-input"
                autoFocus
                placeholder="group name"
                value={newGroup}
                onChange={(event) => setNewGroup(event.target.value)}
                onBlur={() => {
                  if (newGroup.trim()) props.onCreateGroup(newGroup)
                  setNewGroup(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') setNewGroup(null)
                }}
              />
            )}

            {props.groups.map((group) => {
              const items = byGroup.get(group.id) ?? []
              if (needle && items.length === 0) return null
              return (
                <section
                  key={group.id}
                  className={`group ${dropTarget === group.id ? 'drop' : ''}`}
                  {...dropProps(group.id)}
                >
                  <h2>
                    <button
                      type="button"
                      className="chevron"
                      title={group.collapsed ? 'Expand' : 'Collapse'}
                      onClick={() => props.onToggleGroup(group.id, !group.collapsed)}
                    >
                      {group.collapsed ? '▸' : '▾'}
                    </button>
                    {editing === group.id ? (
                      <input
                        className="rename"
                        autoFocus
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitGroupRename(group.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitGroupRename(group.id)
                          if (event.key === 'Escape') setEditing(null)
                        }}
                      />
                    ) : (
                      <span
                        className="group-name"
                        title={group.cwd ?? 'no default folder'}
                        onDoubleClick={() => {
                          setDraft(group.name)
                          setEditing(group.id)
                        }}
                      >
                        {group.name}
                      </span>
                    )}
                    <span className="count">{items.length}</span>
                    <span className="group-actions">
                      <button
                        type="button"
                        title="New session in this group"
                        onClick={() => props.onNew(group.id)}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title="Delete group (sessions move back to No group)"
                        onClick={() => props.onRemoveGroup(group.id)}
                      >
                        ✕
                      </button>
                    </span>
                  </h2>
                  {!group.collapsed &&
                    (items.length === 0 ? (
                      <p className="group-empty">drop sessions here</p>
                    ) : (
                      items.map(renderSession)
                    ))}
                </section>
              )
            })}

            <section
              className={`group ${dropTarget === '' ? 'drop' : ''}`}
              {...dropProps(null)}
            >
              {(ungrouped.length > 0 || props.groups.length > 0) && (
                <h2>
                  <span className="group-name muted">No group</span>
                  <span className="count">{ungrouped.length}</span>
                </h2>
              )}
              {ungrouped.map(renderSession)}
            </section>

            {props.sessions.length === 0 && props.groups.length === 0 && (
              <p className="empty">No sessions yet.</p>
            )}
          </>
        )}

        {tab === 'history' &&
          (historyGroups.length === 0 ? (
            <p className="empty">Nothing in history.</p>
          ) : (
            historyGroups.map(([project, entries]) => (
              <section key={project} className="group">
                <h2>
                  <span className="group-name">{project}</span>
                  <span className="count">{entries.length}</span>
                </h2>
                {entries.map((entry) => {
                  const account = props.accounts.find((a) => a.id === entry.accountId)
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="row history"
                      onClick={() => props.onResume(entry)}
                      title={`${entry.cwd}\nResume with --resume`}
                    >
                      <span
                        className="account-tag"
                        style={{ background: account?.color ?? '#777' }}
                      />
                      <span className="history-body">
                        <span className="row-name">{entry.preview || '(no prompt)'}</span>
                        <span className="row-sub">{timeAgo(entry.updatedAt)}</span>
                      </span>
                    </button>
                  )
                })}
              </section>
            ))
          ))}
      </div>
    </aside>
  )
}
