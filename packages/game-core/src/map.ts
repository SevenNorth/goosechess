import type { MapDefinition } from './types.js'

export interface MovementResult {
  readonly fromSpaceId: number
  readonly path: readonly number[]
  readonly toSpaceId: number
  readonly bounced: boolean
}

export interface MapRegistry {
  get(mapId: string): MapDefinition
  has(mapId: string): boolean
  list(): readonly MapDefinition[]
}

export function createMapRegistry(maps: readonly MapDefinition[]): MapRegistry {
  const definitions = new Map<string, MapDefinition>()
  for (const map of maps) {
    if (definitions.has(map.id)) throw new Error(`Duplicate map id: ${map.id}.`)
    definitions.set(map.id, map)
  }
  return {
    get(mapId) {
      const definition = definitions.get(mapId)
      if (!definition) throw new Error(`Unknown map id: ${mapId}.`)
      return definition
    },
    has: (mapId) => definitions.has(mapId),
    list: () => [...definitions.values()],
  }
}

export function calculateMovementPath(map: Pick<MapDefinition, 'spaces'>, fromSpaceId: number, spaces: number): MovementResult {
  if (!Number.isInteger(spaces)) throw new RangeError('Movement distance must be an integer.')
  const fromIndex = map.spaces.findIndex((space) => space.index === fromSpaceId)
  if (fromIndex < 0) throw new RangeError(`Unknown starting space: ${fromSpaceId}.`)
  if (map.spaces.length < 2) throw new RangeError('A playable map must contain at least two spaces.')

  const path: number[] = []
  let cursor = fromIndex
  let direction = spaces < 0 ? -1 : 1
  let bounced = false
  for (let step = 0; step < Math.abs(spaces); step += 1) {
    if (cursor === map.spaces.length - 1 && direction > 0) {
      direction = -1
      bounced = true
    } else if (cursor === 0 && direction < 0) {
      if (spaces < 0) break
      direction = 1
      bounced = true
    }
    cursor += direction
    path.push(map.spaces[cursor].index)
  }

  return {
    fromSpaceId,
    path,
    toSpaceId: path.at(-1) ?? fromSpaceId,
    bounced,
  }
}

export function calculatePathToNextLandmark(
  map: Pick<MapDefinition, 'spaces' | 'markers'>,
  fromSpaceId: number,
): MovementResult {
  const fromIndex = map.spaces.findIndex((space) => space.index === fromSpaceId)
  if (fromIndex < 0) throw new RangeError('Unknown starting space: ' + fromSpaceId + '.')

  const locationIds = map.markers
    ? new Set(map.markers.filter((marker) => marker.kind === 'location').map((marker) => marker.id))
    : null
  const markerIdOf = (space: MapDefinition['spaces'][number]) => space.markerId ?? space.landmarkId
  const currentMarkerId = markerIdOf(map.spaces[fromIndex])
  const currentLocationId = currentMarkerId && (!locationIds || locationIds.has(currentMarkerId))
    ? currentMarkerId
    : undefined
  const targetIndex = map.spaces.findIndex((space, index) => {
    const markerId = markerIdOf(space)
    return index > fromIndex
      && Boolean(markerId)
      && markerId !== currentLocationId
      && (!locationIds || locationIds.has(markerId!))
  })
  if (targetIndex < 0) {
    return { fromSpaceId, path: [], toSpaceId: fromSpaceId, bounced: false }
  }
  return calculateMovementPath(map, fromSpaceId, targetIndex - fromIndex)
}

export function isWinningSpace(map: Pick<MapDefinition, 'winningSpaceIds'>, spaceId: number) {
  return map.winningSpaceIds.includes(spaceId)
}
