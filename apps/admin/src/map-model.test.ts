import { describe, expect, it } from 'vitest'
import { appendLocationAt, appendSpaceAt, createDefaultMap, csvValues, integerCsvValues, localMapIssues, mapFromUnknown, moveMarkerTo, moveSpaceTo, simulateMapPath, transformMarker } from './map-model'

describe('map model', () => {
  it('clones the default map and passes core validation', () => {
    const first = createDefaultMap()
    const second = createDefaultMap()
    expect(first).not.toBe(second)
    expect(first.spaces).not.toBe(second.spaces)
    expect(localMapIssues(first)).toEqual([])
  })

  it('normalizes pool and winning-space input', () => {
    expect(csvValues('tailwind, shortcut, tailwind')).toEqual(['tailwind', 'shortcut'])
    expect(integerCsvValues('0, 63, nope, 63')).toEqual([0, 63])
  })

  it('migrates legacy landmarks and scoped event arrays into markers and semantic pools', () => {
    const current = createDefaultMap()
    const legacy = {
      ...Object.fromEntries(Object.entries(current)
        .filter(([key]) => key !== 'markers' && key !== 'eventPools')),
      spaces: current.spaces.map((space) => {
        const legacySpace = { ...space } as Record<string, unknown>
        delete legacySpace.markerId
        delete legacySpace.eventPoolId
        return legacySpace
      }),
    }
    const migrated = mapFromUnknown(legacy)
    expect(migrated.markers?.find((marker) => marker.id === 'repair-room')).toMatchObject({ kind: 'start' })
    expect(migrated.markers?.find((marker) => marker.id === 'noise-house')).toMatchObject({ kind: 'finish' })
    expect(migrated.markers?.find((marker) => marker.id === 'snack-stand')).toMatchObject({
      kind: 'location',
      eventPoolId: 'legacy-snack-stand',
    })
    expect(migrated.eventPools?.find((pool) => pool.id === 'legacy-snack-stand')?.eventIds).toHaveLength(3)
    expect(localMapIssues(migrated)).toEqual([])
  })
  it('applies canvas placement through immutable map helpers', () => {
    const base = createDefaultMap()
    const withSpace = appendSpaceAt(base, 321, 123)
    expect(withSpace.spaces.at(-1)).toMatchObject({ index: 66, x: 321, y: 123, kind: 'normal' })
    expect(base.spaces).toHaveLength(66)

    const movedSpace = moveSpaceTo(withSpace, 66, 330, 140)
    expect(movedSpace.spaces[66]).toMatchObject({ x: 330, y: 140 })

    const withLocation = appendLocationAt(movedSpace, 500, 400)
    const location = withLocation.markers?.at(-1)
    expect(location).toMatchObject({ kind: 'location', transform: { x: 500, y: 400 } })
    expect(location).not.toHaveProperty('eventPoolId')
    expect(localMapIssues(withLocation)).toContain(`Location marker ${location!.id} must reference an existing event pool.`)

    const movedMarker = moveMarkerTo(withLocation, location!.id, 520, 410)
    expect(movedMarker.markers?.at(-1)?.transform).toMatchObject({ x: 520, y: 410 })
    expect(movedMarker.landmarks.at(-1)).toMatchObject({ x: 520, y: 410 })

    const transformedMarker = transformMarker(movedMarker, location!.id, { scale: 1.5, rotation: 35 })
    expect(transformedMarker.markers?.at(-1)?.transform).toMatchObject({ x: 520, y: 410, scale: 1.5, rotation: 35 })
    expect(transformedMarker.landmarks.at(-1)).toMatchObject({ x: 520, y: 410, size: 162 })
  })
  it('uses the authoritative bounce path calculation', () => {
    const map = createDefaultMap()
    expect(simulateMapPath(map, 64, 3)).toMatchObject({
      path: [65, 64, 63],
      toSpaceId: 63,
      bounced: true,
    })
  })
})
