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
  const { sessions, accounts, history, connected, refreshHistory } = useManager()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preferredAccount, setPreferredAccount] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  // Painéis já abertos nesta aba do browser — ficam montados pra preservar o
  // scrollback do xterm ao alternar entre sessões.
  const [opened, setOpened] = useState<string[]>([])

  // Tudo derivado da lista que vem do servidor: se uma sessão some, o painel
  // dela some junto sem precisar de efeito de limpeza.
  const activeSession = sessions.find((s) => s.id === selectedId) ?? null
  const activeId = activeSession?.id ?? null
  const activeAccount = accounts.find((a) => a.id === activeSession?.accountId)
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
    const session = await api.create({
      cwd: entry.cwd,
      accountId: entry.accountId,
      resumeId: entry.id,
      name: entry.preview.slice(0, 40) || entry.project,
    })
    open(session.id)
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        accounts={accounts}
        history={history}
        activeId={activeId}
        activeAccountId={accountId}
        connected={connected}
        onSelect={open}
        onNew={() => setModalOpen(true)}
        onResume={(entry) => void resume(entry)}
        onRename={(id, name) => void api.rename(id, name)}
        onStop={(id) => void api.stop(id)}
        onRestart={(id) => void api.restart(id)}
        onRemove={(id) => void api.remove(id)}
        onAccountChange={setPreferredAccount}
      />

      <main className="stage">
        {activeSession ? (
          <header className="stage-head">
            <div className="stage-title">
              <span className={`status ${activeSession.status}`} />
              <h1>{activeSession.name}</h1>
              <span className="path" title={activeSession.cwd}>
                {shortPath(activeSession.cwd)}
              </span>
            </div>
            <div className="stage-meta">
              {activeSession.resumed && <span className="chip">retomada</span>}
              <span
                className="chip account"
                style={{ '--chip': activeAccount?.color ?? '#777' } as React.CSSProperties}
              >
                {activeAccount?.label ?? activeSession.accountId}
              </span>
              {activeSession.status === 'stopped' ? (
                <button type="button" onClick={() => void api.restart(activeSession.id)}>
                  Retomar
                </button>
              ) : (
                <button type="button" onClick={() => void api.stop(activeSession.id)}>
                  Parar
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
              <p>
                Escolha uma sessão na barra lateral, retome uma do histórico ou
                abra uma nova.
              </p>
              <button type="button" onClick={() => setModalOpen(true)}>
                + Nova sessão
              </button>
            </div>
          )}
        </div>
      </main>

      {modalOpen && (
        <NewSessionModal
          accounts={accounts}
          defaultAccountId={accountId}
          knownPaths={knownPaths}
          onClose={() => setModalOpen(false)}
          onCreate={create}
        />
      )}
    </div>
  )
}

export default App
