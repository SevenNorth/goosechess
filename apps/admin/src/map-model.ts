import { DEFAULT_MAP_DEFINITION } from '@goose-chess/game-content'
import { calculateMovementPath, validateMapDefinition, type MapDefinition } from '@goose-chess/game-core'
import { migrateLegacyMapDefinition } from '@goose-chess/content-tools/map-migration'

export function createDefaultMap(): MapDefinition {
  return structuredClone(DEFAULT_MAP_DEFINITION) as MapDefinition
}

export function mapFromUnknown(value: unknown): MapDefinition {
  if (!value || typeof value !== 'object') return createDefaultMap()
  const candidate = value as Partial<MapDefinition>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !Array.isArray(candidate.spaces)) {
    return createDefaultMap()
  }
  const migrated = migrateLegacyMapDefinition(candidate as MapDefinition)
  return {
    ...migrated,
    markers: migrated.markers?.map((marker) => ({
      ...marker,
      transform: { ...marker.transform, opacity: marker.transform.opacity ?? 1 },
    })),
  }
}

export function csvValues(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

export function integerCsvValues(value: string) {
  return [...new Set(csvValues(value).map(Number).filter(Number.isInteger))]
}

export function appendSpaceAt(map: MapDefinition, x: number, y: number): MapDefinition {
  const index = map.spaces.length
  return {
    ...map,
    spaces: [...map.spaces, { index, x, y, rotation: 0, kind: 'normal' }],
  }
}

export function removeSpaceAt(map: MapDefinition, spaceId: number): MapDefinition {
  if (spaceId === 0) throw new RangeError('The starting space cannot be deleted.')
  if (map.spaces.length <= 2) throw new RangeError('A map must retain at least two spaces.')
  if (!map.spaces.some((space) => space.index === spaceId)) throw new RangeError(`Unknown space: ${spaceId}.`)
  const remap = (id: number) => id > spaceId ? id - 1 : id
  const remapIds = (ids: readonly number[]) => ids.filter((id) => id !== spaceId).map(remap)
  return {
    ...map,
    spaces: map.spaces
      .filter((space) => space.index !== spaceId)
      .map((space) => ({ ...space, index: remap(space.index) })),
    winningSpaceIds: remapIds(map.winningSpaceIds),
    markers: map.markers?.map((marker) => ({ ...marker, spaceIds: remapIds(marker.spaceIds) })),
    landmarks: map.landmarks.map((landmark) => ({ ...landmark, spaceIds: remapIds(landmark.spaceIds) })),
  }
}

export function moveSpaceTo(map: MapDefinition, spaceId: number, x: number, y: number): MapDefinition {
  return {
    ...map,
    spaces: map.spaces.map((space) => space.index === spaceId ? { ...space, x, y } : space),
  }
}

export function appendLocationAt(map: MapDefinition, x: number, y: number, asset = ''): MapDefinition {
  const markers = map.markers ?? []
  const usedIds = new Set(markers.map((marker) => marker.id))
  let suffix = markers.length + 1
  while (usedIds.has(`location-${suffix}`)) suffix += 1
  const id = `location-${suffix}`
  const marker = {
    id,
    kind: 'decoration' as const,
    name: '新贴图',
    spaceIds: [],
    asset,
    transform: { x, y, scale: 1, rotation: 0, opacity: 1 },
  }
  return {
    ...map,
    markers: [...markers, marker],
    assets: {
      ...map.assets,
      landmarks: { ...map.assets.landmarks, [id]: asset },
    },
    landmarks: [...map.landmarks, {
      id,
      name: marker.name,
      spaceIds: [],
      x,
      y,
      size: 108,
      pathIntegrated: true,
    }],
  }
}

export function moveMarkerTo(map: MapDefinition, markerId: string, x: number, y: number): MapDefinition {
  return transformMarker(map, markerId, { x, y })
}

export function transformMarker(
  map: MapDefinition,
  markerId: string,
  values: Partial<NonNullable<MapDefinition['markers']>[number]['transform']>,
): MapDefinition {
  const markers = (map.markers ?? []).map((marker) => marker.id === markerId
    ? { ...marker, transform: { ...marker.transform, ...values } }
    : marker)
  const transformed = markers.find((marker) => marker.id === markerId)
  return {
    ...map,
    markers,
    landmarks: map.landmarks.map((landmark) => landmark.id === markerId && transformed
      ? {
          ...landmark,
          x: transformed.transform.x,
          y: transformed.transform.y,
          size: transformed.transform.scale * 108,
        }
      : landmark),
  }
}
export function localMapIssues(map: MapDefinition) {
  return validateMapDefinition(map)
}

export function simulateMapPath(map: MapDefinition, fromSpaceId: number, distance: number) {
  return calculateMovementPath(map, fromSpaceId, distance)
}
