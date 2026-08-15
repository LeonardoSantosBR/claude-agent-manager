import { useMemo, useState } from 'react'
import type { Account, HistorySession, SessionMeta } from '../../shared/types.ts'
import { timeAgo } from '../utils.ts'

interface Props {
  sessions: SessionMeta[]
  accounts: Account[]
  history: HistorySession[]
  activeId: string | null
  activeAccountId: string
  connected: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onResume: (entry: HistorySession) => void
  onRename: (id: string, name: string) => void
  onStop: (id: string) => void
  onRestart: (id: string) => void
  onRemove: (id: string) => void
  onAccountChange: (id: string) => void
}

function groupByProject<T extends { project: string; cwd: string }>(items: T[]) {
  const groups = new Map<string, { cwd: string; items: T[] }>()
  for (const item of items) {
    const group = groups.get(item.project) ?? { cwd: item.cwd, items: [] }
    group.items.push(item)
    groups.set(item.project, group)
  }
  return [...groups.entries()]
}

export function Sidebar(props: Props) {
  const [tab, setTab] = useState<'live' | 'history'>('live')
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const activeAccount = props.accounts.find((a) => a.id === props.activeAccountId)
  const needle = filter.trim().toLowerCase()

  const liveGroups = useMemo(() => {
    const filtered = props.sessions.filter(
      (s) =>
        !needle ||
        s.name.toLowerCase().includes(needle) ||
        s.project.toLowerCase().includes(needle),
    )
    return groupByProject(filtered)
  }, [props.sessions, needle])

  const historyGroups = useMemo(() => {
    const open = new Set(props.sessions.map((s) => s.id))
    const filtered = props.history.filter(
      (h) =>
        !open.has(h.id) &&
        (!needle ||
          h.project.toLowerCase().includes(needle) ||
          h.preview.toLowerCase().includes(needle)),
    )
    return groupByProject(filtered)
  }, [props.history, props.sessions, needle])

  const commitRename = (id: string) => {
    props.onRename(id, draft)
    setEditing(null)
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <div className="brand">
          <span className={`link-dot ${props.connected ? 'on' : 'off'}`} />
          Agent Manager
        </div>

        <div className="accounts" role="group" aria-label="Conta ativa">
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
            Sem login nessa conta. Rode uma vez no terminal:
            <code>CLAUDE_CONFIG_DIR={activeAccount.configDir} claude</code>e faça{' '}
            <code>/login</code>.
          </p>
        )}
      </header>

      <button type="button" className="new-session" onClick={props.onNew}>
        + Nova sessão
      </button>

      <input
        className="search"
        placeholder="Filtrar sessões…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <nav className="tabs">
        <button
          type="button"
          className={tab === 'live' ? 'on' : ''}
          onClick={() => setTab('live')}
        >
          Sessões <span className="count">{props.sessions.length}</span>
        </button>
        <button
          type="button"
          className={tab === 'history' ? 'on' : ''}
          onClick={() => setTab('history')}
        >
          Histórico
        </button>
      </nav>

      <div className="list">
        {tab === 'live' &&
          (liveGroups.length === 0 ? (
            <p className="empty">Nenhuma sessão ainda.</p>
          ) : (
            liveGroups.map(([project, group]) => (
              <section key={project} className="group">
                <h2 title={group.cwd}>
                  {project} <span className="count">{group.items.length}</span>
                </h2>
                {group.items.map((session) => {
                  const account = props.accounts.find((a) => a.id === session.accountId)
                  return (
                    <div
                      key={session.id}
                      className={`row ${session.id === props.activeId ? 'active' : ''}`}
                      onClick={() => props.onSelect(session.id)}
                    >
                      <span
                        className={`status ${session.status}`}
                        title={session.status === 'running' ? 'rodando' : 'parada'}
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
                            title="Parar"
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
                            title="Retomar"
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
                          title="Remover da lista"
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
                })}
              </section>
            ))
          ))}

        {tab === 'history' &&
          (historyGroups.length === 0 ? (
            <p className="empty">Nada no histórico.</p>
          ) : (
            historyGroups.map(([project, group]) => (
              <section key={project} className="group">
                <h2 title={group.cwd}>
                  {project} <span className="count">{group.items.length}</span>
                </h2>
                {group.items.map((entry) => {
                  const account = props.accounts.find((a) => a.id === entry.accountId)
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="row history"
                      onClick={() => props.onResume(entry)}
                      title={`${entry.cwd}\nRetomar com --resume`}
                    >
                      <span
                        className="account-tag"
                        style={{ background: account?.color ?? '#777' }}
                      />
                      <span className="history-body">
                        <span className="row-name">{entry.preview || '(sem prompt)'}</span>
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
