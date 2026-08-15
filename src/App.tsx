import { useCallback, useMemo, useState } from 'react'
import type { CreateSessionBody, HistorySession } from '../shared/types.ts'
import { api } from './api.ts'
import { NewSessionModal } from './components/NewSessionModal.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { TerminalPane } from './components/TerminalPane.tsx'
import { useManager } from './hooks/useManager.ts'
import { shortPath } from './utils.ts'
import './App.css'

function App() {
  const { sessions, groups, accounts, history, connected, refreshHistory } = useManager()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preferredAccount, setPreferredAccount] = useState<string | null>(null)
  // Group the modal opens with: undefined = closed.
  const [modalGroup, setModalGroup] = useState<string | null | undefined>(undefined)
  // Panes already opened in this browser tab — they stay mounted to preserve
  // xterm's scrollback when switching between sessions.
  const [opened, setOpened] = useState<string[]>([])

  // Everything derives from the server's list: when a session disappears, its
  // pane goes with it — no cleanup effect needed.
  const activeSession = sessions.find((s) => s.id === selectedId) ?? null
  const activeId = activeSession?.id ?? null
  const activeAccount = accounts.find((a) => a.id === activeSession?.accountId)
  const activeGroup = groups.find((g) => g.id === activeSession?.groupId)
  const accountId =
    preferredAccount && accounts.some((a) => a.id === preferredAccount)
      ? preferredAccount
      : (accounts[0]?.id ?? 'personal')
  const mounted = opened.filter((id) => sessions.some((s) => s.id === id))

  const open = useCallback((id: string) => {
    setSelectedId(id)
    setOpened((current) => (current.includes(id) ? current : [...current, id]))
  }, [])

  const knownPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const session of sessions) paths.add(session.cwd)
    for (const entry of history) paths.add(entry.cwd)
    return [...paths]
  }, [sessions, history])

  const create = async (body: CreateSessionBody) => {
    const session = await api.create(body)
    open(session.id)
    void refreshHistory()
  }

  const resume = async (entry: HistorySession) => {
    // A resumed session lands in the group whose folder matches it, if any.
    const group = groups.find((candidate) => candidate.cwd === entry.cwd)
    const session = await api.create({
      cwd: entry.cwd,
      accountId: entry.accountId,
      resumeId: entry.id,
      groupId: group?.id ?? null,
      name: entry.preview.slice(0, 40) || entry.project,
    })
    open(session.id)
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        groups={groups}
        accounts={accounts}
        history={history}
        activeId={activeId}
        activeAccountId={accountId}
        connected={connected}
        onSelect={open}
        onNew={(groupId) => setModalGroup(groupId)}
        onResume={(entry) => void resume(entry)}
        onRename={(id, name) => void api.rename(id, name)}
        onStop={(id) => void api.stop(id)}
        onRestart={(id) => void api.restart(id)}
        onRemove={(id) => void api.remove(id)}
        onAccountChange={setPreferredAccount}
        onCreateGroup={(name) => void api.createGroup(name)}
        onRenameGroup={(id, name) => void api.updateGroup(id, { name })}
        onRemoveGroup={(id) => void api.removeGroup(id)}
        onToggleGroup={(id, collapsed) => void api.updateGroup(id, { collapsed })}
        onMoveSession={(id, groupId) => void api.move(id, groupId)}
      />

      <main className="stage">
        {activeSession ? (
          <header className="stage-head">
            <div className="stage-title">
              <span className={`status ${activeSession.status}`} />
              {activeGroup && <span className="crumb">{activeGroup.name} /</span>}
              <h1>{activeSession.name}</h1>
              <span className="path" title={activeSession.cwd}>
                {shortPath(activeSession.cwd)}
              </span>
            </div>
            <div className="stage-meta">
              {activeSession.resumed && <span className="chip">resumed</span>}
              <span
                className="chip account"
                style={{ '--chip': activeAccount?.color ?? '#777' } as React.CSSProperties}
              >
                {activeAccount?.label ?? activeSession.accountId}
              </span>
              {activeSession.status === 'stopped' ? (
                <button type="button" onClick={() => void api.restart(activeSession.id)}>
                  Resume
                </button>
              ) : (
                <button type="button" onClick={() => void api.stop(activeSession.id)}>
                  Stop
                </button>
              )}
            </div>
          </header>
        ) : (
          <header className="stage-head">
            <div className="stage-title">
              <h1>claude agent manager</h1>
            </div>
          </header>
        )}

        <div className="terminals">
          {mounted.map((id) => (
            <TerminalPane key={id} sessionId={id} active={id === activeId} />
          ))}
          {!activeId && (
            <div className="placeholder">
              {!connected && (
                <p className="offline">
                  Server is down. Check the terminal running <code>npm run dev</code> —
                  this page reconnects on its own once it's back.
                </p>
              )}
              <p>
                Choose a session from the sidebar, resume one from your history, or
                start a new one.
              </p>
              <button type="button" onClick={() => setModalGroup(null)}>
                + new session
              </button>
            </div>
          )}
        </div>
      </main>

      {modalGroup !== undefined && (
        <NewSessionModal
          accounts={accounts}
          groups={groups}
          defaultAccountId={accountId}
          defaultGroupId={modalGroup}
          knownPaths={knownPaths}
          onClose={() => setModalGroup(undefined)}
          onCreate={create}
        />
      )}
    </div>
  )
}

export default App
