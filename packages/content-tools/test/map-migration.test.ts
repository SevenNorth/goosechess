import { describe, expect, it } from 'vitest'
import {
  DeterministicRandom,
  calculateMovementPath,
  drawEventChoices,
  validateGameDefinition,
  type GameDefinition,
  type MapDefinition,
} from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { migrateLegacyMapDefinition } from '../src/map-migration.js'

function legacyAupPortMap(): MapDefinition {
  const current = structuredClone(DEFAULT_GAME_DEFINITION.map)
  return {
    ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'markers' && key !== 'eventPools')),
    spaces: current.spaces.map((space) => {
      const legacy = { ...space } as Record<string, unknown>
      delete legacy.markerId
      delete legacy.eventPoolId
      return legacy
    }),
  } as unknown as MapDefinition
}

function definitionWithMap(map: MapDefinition): GameDefinition {
  return { ...DEFAULT_GAME_DEFINITION, map }
}

describe('legacy map migration replay', () => {
  it('preserves the full route, presentation coordinates, assets, and winning spaces', () => {
    const legacy = legacyAupPortMap()
    const migrated = migrateLegacyMapDefinition(legacy)

    expect(migrated.spaces.map(({ index, x, y, rotation, kind }) => ({ index, x, y, rotation, kind })))
      .toEqual(legacy.spaces.map(({ index, x, y, rotation, kind }) => ({ index, x, y, rotation, kind })))
    expect(migrated.winningSpaceIds).toEqual(legacy.winningSpaceIds)
    expect(migrated.assets).toEqual(legacy.assets)
    expect(migrated.landmarks).toEqual(legacy.landmarks)
    for (const fromSpaceId of [0, 1, 17, 40, 63, 64, 65]) {
      for (const distance of [-4, 0, 1, 8, 20]) {
        expect(calculateMovementPath(migrated, fromSpaceId, distance))
          .toEqual(calculateMovementPath(legacy, fromSpaceId, distance))
      }
    }
    expect(validateGameDefinition(definitionWithMap(migrated))).toEqual([])
  })

  it('replays the same event offers for every legacy pool across fixed seeds', () => {
    const legacy = legacyAupPortMap()
    const migrated = migrateLegacyMapDefinition(legacy)
    const legacyDefinition = definitionWithMap(legacy)
    const migratedDefinition = definitionWithMap(migrated)
    const eventSpaces = legacy.spaces.filter((space) => space.kind === 'event')

    for (const space of eventSpaces) {
      const migratedSpace = migrated.spaces[space.index]
      for (const seed of [0, 1, 3, 42, 20260806]) {
        const previous = drawEventChoices(
          legacyDefinition,
          [],
          new DeterministicRandom({ seed, cursor: 0 }),
          space.landmarkId,
        ).map((event) => event.id)
        const next = drawEventChoices(
          migratedDefinition,
          [],
          new DeterministicRandom({ seed, cursor: 0 }),
          migratedSpace.eventPoolId,
        ).map((event) => event.id)
        expect(next).toEqual(previous)
      }
    }
  })

  it('is idempotent after the first explicit migration', () => {
    const migrated = migrateLegacyMapDefinition(legacyAupPortMap())
    expect(migrateLegacyMapDefinition(migrated)).toEqual(migrated)
  })
})
