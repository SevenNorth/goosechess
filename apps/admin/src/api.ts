import type { MapDefinition } from '@goose-chess/game-core'
import type { AuditEntry, ContentDraft, ContentRelease, ManagedEventContent, ManagedSkinContent, PublicUser } from './types'

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.code === 'string' ? body.code : 'request_failed',
      typeof body.message === 'string' ? body.message : '请求失败。',
    )
  }
  return body as T
}

async function uploadAsset(file: File) {
  const response = await fetch('/admin/assets', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(response.status, typeof body.code === 'string' ? body.code : 'request_failed', typeof body.message === 'string' ? body.message : '上传失败。')
  }
  return body as { asset: { url: string; contentType: string; size: number } }
}

async function processSkin(name: string, file: File) {
  const response = await fetch(`/admin/skins/process?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  const body = await response.json() as Record<string, unknown>
  if (!response.ok) {
    throw new ApiError(response.status, typeof body.code === 'string' ? body.code : 'request_failed', typeof body.message === 'string' ? body.message : '皮肤处理失败。')
  }
  return body as { skin: ManagedSkinContent }
}

export const contentApi = {
  login: (username: string, password: string) => request<{ user: PublicUser; expiresAt: number }>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  session: () => request<{ user: PublicUser; expiresAt: number }>('/auth/session'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: PublicUser; permissions: string[] }>('/admin/me'),
  listDrafts: () => request<{ drafts: ContentDraft[] }>('/admin/drafts'),
  getDraft: (id: string) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}`),
  deleteDraft: (id: string) => request<void>(`/admin/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  uploadAsset,
  processSkin,
  createEvent: (title: string, content: ManagedEventContent) => request<{ draft: ContentDraft }>('/admin/drafts', {
    method: 'POST', body: JSON.stringify({ kind: 'event', title, content }),
  }),
  updateEvent: (id: string, expectedRevision: number, title: string, content: ManagedEventContent) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, title, content }),
  }),
  submitDraft: (id: string) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}/submit`, { method: 'POST' }),
  createMap: (title: string, content: MapDefinition) => request<{ draft: ContentDraft }>('/admin/drafts', {
    method: 'POST', body: JSON.stringify({ kind: 'map', title, content }),
  }),
  updateMap: (id: string, expectedRevision: number, title: string, content: MapDefinition) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, title, content }),
  }),
  createSkin: (title: string, content: ManagedSkinContent) => request<{ draft: ContentDraft }>('/admin/drafts', {
    method: 'POST', body: JSON.stringify({ kind: 'skin', title, content }),
  }),
  updateSkin: (id: string, expectedRevision: number, title: string, content: ManagedSkinContent) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, title, content }),
  }),
  reviewDraft: (id: string, decision: 'approve' | 'reject', reason?: string) => request<{ draft: ContentDraft }>(`/admin/drafts/${encodeURIComponent(id)}/review`, {
    method: 'POST', body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  }),
  publishDraft: (id: string) => request<{ release: ContentRelease }>(`/admin/drafts/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
  listReleases: () => request<{ releases: ContentRelease[] }>('/admin/releases'),
  rollback: (version: string) => request<{ release: ContentRelease }>(`/admin/releases/${encodeURIComponent(version)}/rollback`, { method: 'POST' }),
  listAudit: (limit = 100) => request<{ audit: AuditEntry[] }>(`/admin/audit?limit=${limit}`),
}
