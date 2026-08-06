import { assertValidGameDefinition, type GameDefinition } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { PROTOCOL_SCHEMA_VERSION, type RoomState } from '@goose-chess/game-protocol'

export interface LoadedRoomContent {
  readonly definition: GameDefinition
  readonly assetBaseUrl: string | null
  readonly serverUrl: string
  readonly maps: readonly RoomMapSummary[]
}

export interface RoomMapSummary {
  readonly id: string
  readonly mapVersion: string
  readonly name: string
  readonly spaceCount: number
  readonly markerCount: number
  readonly backgroundAsset: string
}

interface RoomContentIdentity {
  readonly recoveryToken: string
  readonly serverUrl: string
}

const contentCache = new Map<string, Promise<LoadedRoomContent>>()
const builtInCache = new Map<string, LoadedRoomContent>()

function normalizeServerUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('游戏服务地址必须使用 http 或 https。')
  return url.toString().replace(/\/$/, '')
}

function builtInContent(room: RoomState, serverUrl: string): LoadedRoomContent | null {
  if (
    room.contentVersion !== DEFAULT_GAME_DEFINITION.contentVersion
    || room.mapId !== DEFAULT_GAME_DEFINITION.map.id
    || room.mapVersion !== `builtin:${DEFAULT_GAME_DEFINITION.map.id}`
    || room.rulesetVersion !== DEFAULT_GAME_DEFINITION.ruleset.version
  ) return null
  const normalizedServerUrl = normalizeServerUrl(serverUrl)
  const cached = builtInCache.get(normalizedServerUrl)
  if (cached) return cached
  const content = {
    definition: DEFAULT_GAME_DEFINITION,
    assetBaseUrl: null,
    serverUrl: normalizedServerUrl,
    maps: [{
      id: DEFAULT_GAME_DEFINITION.map.id,
      mapVersion: `builtin:${DEFAULT_GAME_DEFINITION.map.id}`,
      name: DEFAULT_GAME_DEFINITION.map.name,
      spaceCount: DEFAULT_GAME_DEFINITION.map.spaces.length,
      markerCount: (DEFAULT_GAME_DEFINITION.map.markers ?? DEFAULT_GAME_DEFINITION.map.landmarks).length,
      backgroundAsset: DEFAULT_GAME_DEFINITION.map.assets.background,
    }],
  }
  builtInCache.set(normalizedServerUrl, content)
  return content
}

function parseRoomContent(value: unknown, room: RoomState, serverUrl: string): LoadedRoomContent {
  if (!value || typeof value !== 'object') throw new Error('游戏服务返回了无效的房间内容。')
  const payload = value as Record<string, unknown>
  if (payload.schemaVersion !== PROTOCOL_SCHEMA_VERSION) throw new Error('房间内容协议版本不一致。')
  if (payload.contentVersion !== room.contentVersion || payload.mapVersion !== room.mapVersion) {
    throw new Error('房间内容版本与权威房间状态不一致。')
  }
  const definition = payload.definition as GameDefinition
  assertValidGameDefinition(definition)
  if (
    definition.contentVersion !== room.contentVersion
    || definition.map.id !== room.mapId
    || definition.ruleset.version !== room.rulesetVersion
  ) throw new Error('房间定义与权威房间状态不一致。')
  const assetBaseUrl = payload.assetBaseUrl === null
    ? null
    : typeof payload.assetBaseUrl === 'string' ? normalizeServerUrl(payload.assetBaseUrl) : null
  if (!Array.isArray(payload.maps)) throw new Error('房间地图清单无效。')
  const maps = payload.maps.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('房间地图清单无效。')
    const map = value as Record<string, unknown>
    if (
      typeof map.id !== 'string' || typeof map.mapVersion !== 'string' || typeof map.name !== 'string'
      || !Number.isInteger(map.spaceCount) || !Number.isInteger(map.markerCount)
      || typeof map.backgroundAsset !== 'string'
    ) throw new Error('房间地图清单无效。')
    return map as unknown as RoomMapSummary
  })
  if (!maps.some((map) => map.id === room.mapId && map.mapVersion === room.mapVersion)) {
    throw new Error('当前地图不在房间锁定的地图清单中。')
  }
  return { definition: structuredClone(definition), assetBaseUrl, serverUrl: normalizeServerUrl(serverUrl), maps }
}

async function requestRoomContent(
  room: RoomState,
  identity: RoomContentIdentity,
  redirected = false,
): Promise<LoadedRoomContent> {
  const serverUrl = normalizeServerUrl(identity.serverUrl)
  const response = await fetch(`${serverUrl}/rooms/${encodeURIComponent(room.roomCode)}/content`, {
    headers: { Authorization: `Bearer ${identity.recoveryToken}` },
  })
  const payload = await response.json() as unknown
  if (!response.ok) {
    const error = payload as { message?: unknown; ownerUrl?: unknown }
    if (response.status === 409 && !redirected && typeof error.ownerUrl === 'string') {
      return requestRoomContent(room, { ...identity, serverUrl: error.ownerUrl }, true)
    }
    throw new Error(typeof error.message === 'string' ? error.message : '无法读取房间内容。')
  }
  return parseRoomContent(payload, room, serverUrl)
}

export function localRoomContent(room: RoomState, serverUrl: string) {
  return builtInContent(room, serverUrl)
}

export function loadRoomContent(room: RoomState, identity: RoomContentIdentity) {
  const builtIn = builtInContent(room, identity.serverUrl)
  if (builtIn) return Promise.resolve(builtIn)
  const key = [normalizeServerUrl(identity.serverUrl), room.roomCode, room.contentVersion, room.mapVersion].join('|')
  const cached = contentCache.get(key)
  if (cached) return cached
  const pending = requestRoomContent(room, identity).catch((error) => {
    contentCache.delete(key)
    throw error
  })
  contentCache.set(key, pending)
  return pending
}

export function resolveRoomAsset(asset: string, content: LoadedRoomContent) {
  if (/^https?:\/\//i.test(asset) || asset.startsWith('data:')) return asset
  if (asset.startsWith('/content-assets/') && content.assetBaseUrl) {
    return new URL(asset, `${content.assetBaseUrl}/`).toString()
  }
  return asset.startsWith('/') ? asset : `/${asset}`
}

export function clearRoomContentCacheForTests() {
  contentCache.clear()
  builtInCache.clear()
}
