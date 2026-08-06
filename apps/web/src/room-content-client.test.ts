import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { PROTOCOL_SCHEMA_VERSION, type RoomState } from '@goose-chess/game-protocol'
import {
  clearRoomContentCacheForTests,
  loadRoomContent,
  resolveRoomAsset,
} from './room-content-client'

function customRoom(): RoomState {
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    roomCode: 'ABC123',
    gameId: 'online-abc123',
    hostPlayerId: 'host',
    mapId: DEFAULT_GAME_DEFINITION.map.id,
    mapVersion: 'map-v2',
    contentVersion: 'content-v2',
    rulesetVersion: 22,
    maxPlayers: 4,
    reconnectGraceMs: 30_000,
    status: 'waiting',
    players: [],
  }
}

function customDefinition() {
  return {
    ...structuredClone(DEFAULT_GAME_DEFINITION),
    contentVersion: 'content-v2',
    map: { ...structuredClone(DEFAULT_GAME_DEFINITION.map), name: '新版奥普港' },
    ruleset: { ...structuredClone(DEFAULT_GAME_DEFINITION.ruleset), version: 22 },
  }
}

describe('room content client', () => {
  afterEach(() => {
    clearRoomContentCacheForTests()
    vi.unstubAllGlobals()
  })

  it('loads an exact locked definition, follows its owner, and caches the result', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(String(input))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer recovery-secret')
      if (requests.length === 1) return new Response(JSON.stringify({ message: 'moved', ownerUrl: 'https://owner-b.example.com' }), { status: 409 })
      return new Response(JSON.stringify({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        contentVersion: 'content-v2',
        mapVersion: 'map-v2',
        assetBaseUrl: 'https://assets.example.com/',
        maps: [{
          id: DEFAULT_GAME_DEFINITION.map.id,
          mapVersion: 'map-v2',
          name: '新版奥普港',
          spaceCount: DEFAULT_GAME_DEFINITION.map.spaces.length,
          markerCount: DEFAULT_GAME_DEFINITION.map.landmarks.length,
          backgroundAsset: '/content-assets/map.png',
        }],
        definition: customDefinition(),
      }), { status: 200 })
    }))

    const room = customRoom()
    const first = await loadRoomContent(room, { recoveryToken: 'recovery-secret', serverUrl: 'https://owner-a.example.com' })
    const second = await loadRoomContent(room, { recoveryToken: 'recovery-secret', serverUrl: 'https://owner-a.example.com' })
    expect(first.definition.map.name).toBe('新版奥普港')
    expect(first.serverUrl).toBe('https://owner-b.example.com')
    expect(second.definition.contentVersion).toBe('content-v2')
    expect(requests).toEqual([
      'https://owner-a.example.com/rooms/ABC123/content',
      'https://owner-b.example.com/rooms/ABC123/content',
    ])
    expect(resolveRoomAsset('/content-assets/map.png', first)).toBe('https://assets.example.com/content-assets/map.png')
    expect(resolveRoomAsset('assets/tokens/default.png', first)).toBe('/assets/tokens/default.png')
  })

  it('rejects a definition that does not match the room version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      contentVersion: 'wrong-version',
      mapVersion: 'map-v2',
      assetBaseUrl: null,
      maps: [],
      definition: customDefinition(),
    }), { status: 200 })))
    await expect(loadRoomContent(customRoom(), {
      recoveryToken: 'recovery-secret',
      serverUrl: 'https://owner.example.com',
    })).rejects.toThrow('房间内容版本与权威房间状态不一致')
  })
})
