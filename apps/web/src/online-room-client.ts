import { RoomJoinResponseSchema, type RoomJoinResponse } from '@goose-chess/game-protocol'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787'
const IDENTITY_PREFIX = 'goose-chess-online-room-v1:'

export interface OnlineIdentity {
  readonly playerId: string
  readonly recoveryToken: string
  readonly serverUrl: string
}

export function gameServerUrl() {
  const configured = import.meta.env.VITE_GAME_SERVER_URL?.trim()
  const fallback = import.meta.env.PROD ? window.location.origin : DEFAULT_SERVER_URL
  return normalizeServerUrl(configured || fallback)
}

function normalizeServerUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('游戏服务地址必须使用 http 或 https。')
  return url.toString().replace(/\/$/, '')
}

async function postRoom(path: string, body: unknown, baseUrl = gameServerUrl(), redirected = false): Promise<RoomJoinResponse> {
  const serverUrl = normalizeServerUrl(baseUrl)
  const response = await fetch(serverUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as unknown
  if (!response.ok) {
    const error = payload as { message?: unknown; ownerUrl?: unknown }
    if (
      response.status === 409
      && !redirected
      && typeof error.ownerUrl === 'string'
      && normalizeServerUrl(error.ownerUrl) !== serverUrl
    ) {
      return postRoom(path, body, error.ownerUrl, true)
    }
    throw new Error(typeof error.message === 'string' ? error.message : '在线房间请求失败。')
  }
  return RoomJoinResponseSchema.parse(payload)
}

export function saveOnlineIdentity(joined: RoomJoinResponse) {
  const identity: OnlineIdentity = {
    playerId: joined.playerId,
    recoveryToken: joined.recoveryToken,
    serverUrl: joined.serverUrl,
  }
  window.sessionStorage.setItem(IDENTITY_PREFIX + joined.room.roomCode, JSON.stringify(identity))
}

export function updateOnlineIdentityServerUrl(roomCode: string, serverUrl: string) {
  const key = IDENTITY_PREFIX + roomCode.toUpperCase()
  try {
    const current = JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as Partial<OnlineIdentity> | null
    if (!current || typeof current.playerId !== 'string' || typeof current.recoveryToken !== 'string') return
    window.sessionStorage.setItem(key, JSON.stringify({
      playerId: current.playerId,
      recoveryToken: current.recoveryToken,
      serverUrl: normalizeServerUrl(serverUrl),
    }))
  } catch {
    // Invalid legacy storage is handled by loadOnlineIdentity.
  }
}

export function loadOnlineIdentity(roomCode: string): OnlineIdentity | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(IDENTITY_PREFIX + roomCode.toUpperCase()) ?? 'null') as Partial<OnlineIdentity> | null
    if (!value || typeof value.playerId !== 'string' || typeof value.recoveryToken !== 'string') return null
    const serverUrl = typeof value.serverUrl === 'string' ? normalizeServerUrl(value.serverUrl) : gameServerUrl()
    return { playerId: value.playerId, recoveryToken: value.recoveryToken, serverUrl }
  } catch {
    return null
  }
}

export async function createOnlineRoom(displayName: string, skinId: string) {
  const joined = await postRoom('/rooms', { displayName, skinId })
  saveOnlineIdentity(joined)
  return joined
}

export async function joinOnlineRoom(roomCode: string, displayName: string, skinId: string) {
  const normalizedCode = roomCode.trim().toUpperCase()
  const existing = loadOnlineIdentity(normalizedCode)
  const joined = await postRoom(`/rooms/${encodeURIComponent(normalizedCode)}/join`, {
    displayName,
    skinId,
    ...(existing ? { recoveryToken: existing.recoveryToken } : {}),
  }, existing?.serverUrl)
  saveOnlineIdentity(joined)
  return joined
}

export function roomSocketUrl(roomCode: string, recoveryToken: string, serverUrl = gameServerUrl()) {
  const url = new URL(normalizeServerUrl(serverUrl))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/rooms/${roomCode.toUpperCase()}/connect`
  url.search = new URLSearchParams({ token: recoveryToken }).toString()
  return url.toString()
}
