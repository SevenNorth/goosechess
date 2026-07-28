import { describe, expect, it } from 'vitest'
import { calculateMovementPath, createMapRegistry, validateGameDefinition } from '@goose-chess/game-core'
import {
  DEFAULT_CONTENT_MANIFEST,
  DEFAULT_GAME_DEFINITION,
  DEFAULT_MAP_DEFINITION,
  DEFAULT_MAP_CONTENT,
  EVENTS,
  ITEMS,
  LANDMARK_DEFINITIONS,
  TEST_MAP_DEFINITION,
} from '../src/index.js'

function hasUniqueIds(entries: readonly { id: string }[]) {
  return new Set(entries.map((entry) => entry.id)).size === entries.length
}

describe('default content manifest', () => {
  it('contains structured and uniquely identified content', () => {
    expect(hasUniqueIds(EVENTS)).toBe(true)
    expect(hasUniqueIds(ITEMS)).toBe(true)
    expect(hasUniqueIds(LANDMARK_DEFINITIONS)).toBe(true)
    expect(JSON.parse(JSON.stringify(DEFAULT_CONTENT_MANIFEST))).toEqual(DEFAULT_CONTENT_MANIFEST)
    expect(EVENTS).toHaveLength(24)
    expect(ITEMS).toHaveLength(12)
  })

  it('records the three winning spaces separately from the noise house landmark', () => {
    expect(DEFAULT_MAP_CONTENT.winningSpaceIds).toEqual([63, 64, 65])
    expect(LANDMARK_DEFINITIONS.find((landmark) => landmark.id === 'noise-house')?.spaceIds).toEqual([63, 64, 65])
  })

  it('loads the ordered 0-65 map and validates every content reference', () => {
    expect(DEFAULT_MAP_DEFINITION.spaces.map((space) => space.index)).toEqual(Array.from({ length: 66 }, (_, index) => index))
    expect(DEFAULT_MAP_DEFINITION.spaces.slice(63).map((space) => space.landmarkId)).toEqual(['noise-house', 'noise-house', 'noise-house'])
    expect(new Set(DEFAULT_MAP_DEFINITION.spaces.map((space) => `${space.x}:${space.y}`)).size).toBe(66)
    expect(DEFAULT_MAP_DEFINITION.landmarks.every((landmark) => Number.isFinite(landmark.x) && Number.isFinite(landmark.y))).toBe(true)
    expect(validateGameDefinition(DEFAULT_GAME_DEFINITION)).toEqual([])
  })

  it('supports a different-size map without a 65-space assumption', () => {
    const registry = createMapRegistry([DEFAULT_MAP_DEFINITION, TEST_MAP_DEFINITION])
    expect(registry.get(TEST_MAP_DEFINITION.id).spaces).toHaveLength(8)
    expect(calculateMovementPath(TEST_MAP_DEFINITION, 5, 4)).toMatchObject({ path: [6, 7, 6, 5], toSpaceId: 5 })
  })

  it('rejects unreachable check thresholds while loading content', () => {
    const invalid = {
      ...DEFAULT_GAME_DEFINITION,
      events: DEFAULT_GAME_DEFINITION.events.map((event, index) => index === 0 ? { ...event, kind: '骰子检定' as const, threshold: 13 } : event),
    }
    expect(validateGameDefinition(invalid)).toContain(`Event ${invalid.events[0].id} has an unreachable two-die threshold.`)
  })
})
