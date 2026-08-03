import { RoomJoinResponseSchema, type RoomJoinResponse } from '@goose-chess/game-protocol'

const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787'
const IDENTITY_PREFIX = 'goose-chess-online-room-v1:'

export interface OnlineIdentity {
  readonly playerId: string
  readonly recoveryToken: string
}

export function gameServerUrl() {
  return (import.meta.env.VITE_GAME_SERVER_URL ?? DEFAULT_SERVER_URL).replace(/\/$/, '')
}

async function postRoom(path: string, body: unknown) {
  const response = await fetch(gameServerUrl() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json() as unknown
  if (!response.ok) {
    const error = payload as { message?: unknown }
    throw new Error(typeof error.message === 'string' ? error.message : '在线房间请求失败。')
  }
  return RoomJoinResponseSchema.parse(payload)
}

export function saveOnlineIdentity(joined: RoomJoinResponse) {
  const identity: OnlineIdentity = {
    playerId: joined.playerId,
    recoveryToken: joined.recoveryToken,
  }
  window.sessionStorage.setItem(IDENTITY_PREFIX + joined.room.roomCode, JSON.stringify(identity))
}

export function loadOnlineIdentity(roomCode: string): OnlineIdentity | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(IDENTITY_PREFIX + roomCode.toUpperCase()) ?? 'null') as Partial<OnlineIdentity> | null
    return value && typeof value.playerId === 'string' && typeof value.recoveryToken === 'string'
      ? { playerId: value.playerId, recoveryToken: value.recoveryToken }
      : null
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
  })
  saveOnlineIdentity(joined)
  return joined
}

export function roomSocketUrl(roomCode: string, recoveryToken: string) {
  const url = new URL(gameServerUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/rooms/${roomCode.toUpperCase()}/connect`
  url.search = new URLSearchParams({ token: recoveryToken }).toString()
  return url.toString()
}
