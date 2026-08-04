// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PROTOCOL_SCHEMA_VERSION,
  type RoomJoinResponse,
} from '@goose-chess/game-protocol'
import {
  joinOnlineRoom,
  loadOnlineIdentity,
  roomSocketUrl,
  updateOnlineIdentityServerUrl,
} from './online-room-client'

function joinedRoom(serverUrl: string): RoomJoinResponse {
  return {
    room: {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      roomCode: 'ABC123',
      gameId: 'online-abc123',
      hostPlayerId: 'player-host',
      mapId: 'aup-port-65',
      maxPlayers: 4,
      reconnectGraceMs: 30_000,
      status: 'waiting',
      players: [{
        playerId: 'player-host',
        displayName: '房主',
        skinId: 'goose-white',
        seatIndex: 0,
        controller: 'remote',
        connected: false,
        reconnectDeadlineAt: null,
        ready: false,
      }],
    },
    playerId: 'player-host',
    recoveryToken: 'recovery-host',
    serverUrl,
  }
}

describe('online room owner routing', () => {
  afterEach(() => {
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps legacy room identities usable with the configured server fallback', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: 'player-host',
      recoveryToken: 'recovery-host',
    }))

    expect(loadOnlineIdentity('abc123')).toEqual({
      playerId: 'player-host',
      recoveryToken: 'recovery-host',
      serverUrl: 'http://127.0.0.1:8787',
    })
  })

  it('retries a join against the active owner and persists its server URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          code: 'room_owned_elsewhere',
          message: '房间由其他服务实例承载。',
          ownerUrl: 'https://game-b.example.com',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => joinedRoom('https://game-b.example.com'),
      })
    vi.stubGlobal('fetch', fetchMock)

    const joined = await joinOnlineRoom('abc123', '房主', 'goose-white')

    expect(joined.serverUrl).toBe('https://game-b.example.com')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8787/rooms/ABC123/join',
      'https://game-b.example.com/rooms/ABC123/join',
    ])
    expect(loadOnlineIdentity('ABC123')?.serverUrl).toBe('https://game-b.example.com')
  })

  it('updates the room socket endpoint after an owner migration message', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: 'player-host',
      recoveryToken: 'recovery-host',
      serverUrl: 'https://game-a.example.com',
    }))

    updateOnlineIdentityServerUrl('ABC123', 'https://game-b.example.com/')
    const identity = loadOnlineIdentity('ABC123')

    expect(identity?.serverUrl).toBe('https://game-b.example.com')
    expect(roomSocketUrl('ABC123', identity!.recoveryToken, identity!.serverUrl)).toBe(
      'wss://game-b.example.com/rooms/ABC123/connect?token=recovery-host',
    )
  })
})
