import { DEFAULT_MAP_DEFINITION } from '@goose-chess/game-content'
import { calculateMovementPath, validateMapDefinition, type MapDefinition } from '@goose-chess/game-core'

export function createDefaultMap(): MapDefinition {
  return structuredClone(DEFAULT_MAP_DEFINITION) as MapDefinition
}

function migrateLegacyMap(candidate: MapDefinition): MapDefinition {
  if (candidate.markers && candidate.eventPools) return structuredClone(candidate)

  const legacyPools = candidate.landmarkEventPoolIds ?? {}
  const eventPools = [
    ...((candidate.genericEventPoolIds?.length ?? 0) >= 3
      ? [{ id: 'general', name: '通用', eventIds: candidate.genericEventPoolIds! }]
      : []),
    ...candidate.landmarks.flatMap((landmark) => {
      const eventIds = legacyPools[landmark.id]
      return (eventIds?.length ?? 0) >= 3
        ? [{ id: `legacy-${landmark.id}`, name: landmark.name, eventIds }]
        : []
    }),
  ]
  const eventPoolIdByMarker = new Map(candidate.landmarks.map((landmark) => [
    landmark.id,
    legacyPools[landmark.id] ? `legacy-${landmark.id}` : undefined,
  ]))
  const markers = candidate.landmarks.map((landmark) => {
    const kind = landmark.spaceIds.some((spaceId) => candidate.winningSpaceIds.includes(spaceId))
      ? 'finish' as const
      : landmark.spaceIds.includes(candidate.spaces[0]?.index ?? 0)
        ? 'start' as const
        : 'location' as const
    const eventPoolId = kind === 'location'
      ? eventPoolIdByMarker.get(landmark.id) ?? (eventPools.some((pool) => pool.id === 'general') ? 'general' : undefined)
      : undefined
    return {
      id: landmark.id,
      kind,
      name: landmark.name,
      spaceIds: landmark.spaceIds,
      ...(eventPoolId ? { eventPoolId } : {}),
      asset: candidate.assets.landmarks?.[landmark.id] ?? '',
      transform: {
        x: landmark.x ?? candidate.spaces[landmark.spaceIds[0]]?.x ?? 0,
        y: landmark.y ?? candidate.spaces[landmark.spaceIds[0]]?.y ?? 0,
        scale: (landmark.size ?? 108) / 108,
        rotation: 0,
      },
    }
  })
  const markerById = new Map(markers.map((marker) => [marker.id, marker]))
  return {
    ...structuredClone(candidate),
    spaces: candidate.spaces.map((space) => {
      const markerId = space.markerId ?? space.landmarkId
      const marker = markerId ? markerById.get(markerId) : undefined
      return {
        ...space,
        ...(markerId ? { markerId } : {}),
        ...(space.kind === 'event'
          ? { eventPoolId: space.eventPoolId ?? marker?.eventPoolId ?? (eventPools.some((pool) => pool.id === 'general') ? 'general' : undefined) }
          : {}),
      }
    }),
    markers,
    eventPools,
  }
}

export function mapFromUnknown(value: unknown): MapDefinition {
  if (!value || typeof value !== 'object') return createDefaultMap()
  const candidate = value as Partial<MapDefinition>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !Array.isArray(candidate.spaces)) {
    return createDefaultMap()
  }
  return migrateLegacyMap(candidate as MapDefinition)
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

export function moveSpaceTo(map: MapDefinition, spaceId: number, x: number, y: number): MapDefinition {
  return {
    ...map,
    spaces: map.spaces.map((space) => space.index === spaceId ? { ...space, x, y } : space),
  }
}

export function appendLocationAt(map: MapDefinition, x: number, y: number): MapDefinition {
  const markers = map.markers ?? []
  const usedIds = new Set(markers.map((marker) => marker.id))
  let suffix = markers.length + 1
  while (usedIds.has(`location-${suffix}`)) suffix += 1
  const id = `location-${suffix}`
  const marker = {
    id,
    kind: 'location' as const,
    name: '新地点',
    spaceIds: [],
    asset: '',
    transform: { x, y, scale: 1, rotation: 0 },
  }
  return {
    ...map,
    markers: [...markers, marker],
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
