import type { MapDefinition } from '@goose-chess/game-core'

export function migrateLegacyMapDefinition(candidate: MapDefinition): MapDefinition {
  if (candidate.markers && candidate.eventPools) return structuredClone(candidate)

  const legacyPools = candidate.landmarkEventPoolIds ?? {}
  const hasGeneralPool = (candidate.genericEventPoolIds?.length ?? 0) >= 3
  const eventPools = [
    ...(hasGeneralPool
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
  const markers = candidate.markers ?? candidate.landmarks.map((landmark) => {
    const kind = landmark.spaceIds.some((spaceId) => candidate.winningSpaceIds.includes(spaceId))
      ? 'finish' as const
      : landmark.spaceIds.includes(candidate.spaces[0]?.index ?? 0)
        ? 'start' as const
        : 'location' as const
    const eventPoolId = kind === 'location'
      ? eventPoolIdByMarker.get(landmark.id) ?? (hasGeneralPool ? 'general' : undefined)
      : undefined
    const anchor = candidate.spaces.find((space) => space.index === landmark.spaceIds[0])
    return {
      id: landmark.id,
      kind,
      name: landmark.name,
      spaceIds: landmark.spaceIds,
      ...(eventPoolId ? { eventPoolId } : {}),
      asset: candidate.assets.landmarks?.[landmark.id] ?? '',
      transform: {
        x: landmark.x ?? anchor?.x ?? 0,
        y: landmark.y ?? anchor?.y ?? 0,
        scale: (landmark.size ?? 108) / 108,
        rotation: 0,
        opacity: 1,
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
          ? { eventPoolId: space.eventPoolId ?? marker?.eventPoolId ?? (hasGeneralPool ? 'general' : undefined) }
          : {}),
      }
    }),
    markers: structuredClone(markers),
    eventPools,
  }
}
