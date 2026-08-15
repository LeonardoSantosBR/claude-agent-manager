import type {
  Account,
  CreateSessionBody,
  HistorySession,
  SessionMeta,
} from '../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(body.error ?? 'falha na requisição')
  }
  return response.json() as Promise<T>
}

export const api = {
  accounts: () => request<Account[]>('/accounts'),
  sessions: () => request<SessionMeta[]>('/sessions'),
  history: () => request<HistorySession[]>('/history'),
  create: (body: CreateSessionBody) =>
    request<SessionMeta>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  rename: (id: string, name: string) =>
    request<SessionMeta>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  restart: (id: string) => request<SessionMeta>(`/sessions/${id}/restart`, { method: 'POST' }),
  stop: (id: string) => request<{ ok: true }>(`/sessions/${id}/stop`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: true }>(`/sessions/${id}`, { method: 'DELETE' }),
  /** Abre o seletor de pasta nativo no desktop. null = cancelado. */
  pickFolder: (startIn?: string) =>
    request<{ path: string | null }>('/pick-folder', {
      method: 'POST',
      body: JSON.stringify({ startIn }),
    }),
}
