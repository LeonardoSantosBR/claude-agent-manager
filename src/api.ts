import type {
  AuthStatus,
  CreateSessionBody,
  Group,
  HistorySession,
  LoginState,
  SessionMeta,
} from '../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(body.error ?? 'request failed')
  }
  return response.json() as Promise<T>
}

export const api = {
  auth: () => request<AuthStatus>('/auth'),
  /** Starts the `claude` login and returns as soon as it is running. */
  login: () => request<LoginState>('/auth/login', { method: 'POST' }),
  loginState: () => request<LoginState>('/auth/login'),
  loginCode: (code: string) =>
    request<LoginState>('/auth/login/code', { method: 'POST', body: JSON.stringify({ code }) }),
  loginCancel: () => request<LoginState>('/auth/login/cancel', { method: 'POST' }),
  logout: () => request<AuthStatus>('/auth/logout', { method: 'POST' }),
  sessions: () => request<SessionMeta[]>('/sessions'),
  history: () => request<HistorySession[]>('/history'),
  create: (body: CreateSessionBody) =>
    request<SessionMeta>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
  rename: (id: string, name: string) =>
    request<SessionMeta>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  move: (id: string, groupId: string | null) =>
    request<SessionMeta>(`/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ groupId }),
    }),
  groups: () => request<Group[]>('/groups'),
  createGroup: (name: string, cwd?: string | null) =>
    request<Group>('/groups', { method: 'POST', body: JSON.stringify({ name, cwd }) }),
  updateGroup: (id: string, patch: Partial<Pick<Group, 'name' | 'cwd' | 'collapsed'>>) =>
    request<Group>(`/groups/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeGroup: (id: string) => request<{ ok: true }>(`/groups/${id}`, { method: 'DELETE' }),
  restart: (id: string) => request<SessionMeta>(`/sessions/${id}/restart`, { method: 'POST' }),
  stop: (id: string) => request<{ ok: true }>(`/sessions/${id}/stop`, { method: 'POST' }),
  remove: (id: string) => request<{ ok: true }>(`/sessions/${id}`, { method: 'DELETE' }),
  /** Opens the native folder picker on the desktop. null = cancelled. */
  pickFolder: (startIn?: string) =>
    request<{ path: string | null }>('/pick-folder', {
      method: 'POST',
      body: JSON.stringify({ startIn }),
    }),
}
