import { describe, expect, it } from 'vitest'
import { calculateMovementPath, createMapRegistry, validateGameDefinition } from '@goose-chess/game-core'
import {
  DEFAULT_CONTENT_MANIFEST,
  DEFAULT_EVENT_POOLS,
  DEFAULT_GAME_DEFINITION,
  DEFAULT_MAP_DEFINITION,
  DEFAULT_MAP_CONTENT,
  DEFAULT_MAP_MARKERS,
  EVENTS,
  GENERIC_EVENT_POOL_IDS,
  ITEMS,
  LANDMARK_DEFINITIONS,
  LANDMARK_EVENT_POOL_IDS,
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
    expect(EVENTS).toHaveLength(27)
    expect(ITEMS).toHaveLength(12)
  })

  it('records the three winning spaces separately from the noise house landmark', () => {
    expect(DEFAULT_MAP_CONTENT.winningSpaceIds).toEqual([63, 64, 65])
    expect(LANDMARK_DEFINITIONS.find((landmark) => landmark.id === 'noise-house')?.spaceIds).toEqual([63, 64, 65])
  })
  it('migrates Aup Port to semantic pools and typed map markers', () => {
    expect(DEFAULT_EVENT_POOLS.map((pool) => pool.id)).toContain('general')
    expect(DEFAULT_EVENT_POOLS.map((pool) => pool.id)).toContain('aup-food')
    const start = DEFAULT_MAP_MARKERS.find((marker) => marker.id === 'repair-room')
    const finish = DEFAULT_MAP_MARKERS.find((marker) => marker.id === 'noise-house')
    expect(start).toMatchObject({ kind: 'start' })
    expect(start).not.toHaveProperty('eventPoolId')
    expect(finish).toMatchObject({ kind: 'finish' })
    expect(finish).not.toHaveProperty('eventPoolId')
    expect(DEFAULT_MAP_MARKERS.filter((marker) => marker.kind === 'location')).toHaveLength(7)
    expect(DEFAULT_MAP_MARKERS.filter((marker) => marker.kind === 'location')
      .every((marker) => DEFAULT_EVENT_POOLS.some((pool) => pool.id === marker.eventPoolId))).toBe(true)
  })

  it('integrates single-space landmark art into the route without hiding finish spaces', () => {
    const pathLandmarks = DEFAULT_MAP_DEFINITION.landmarks.filter((landmark) => landmark.pathIntegrated)
    expect(pathLandmarks).toHaveLength(8)
    expect(pathLandmarks.every((landmark) => landmark.spaceIds.length === 1)).toBe(true)
    expect(pathLandmarks.every((landmark) => {
      const space = DEFAULT_MAP_DEFINITION.spaces[landmark.spaceIds[0]]
      return landmark.x === space.x && space.landmarkId === landmark.id
    })).toBe(true)

    const noiseHouse = DEFAULT_MAP_DEFINITION.landmarks.find((landmark) => landmark.id === 'noise-house')
    expect(noiseHouse?.pathIntegrated).toBe(false)
    expect(DEFAULT_MAP_DEFINITION.spaces.slice(63).map((space) => space.kind)).toEqual(['finish', 'finish', 'finish'])
  })

  it('keeps neighboring route spaces visually even', () => {
    const distances = DEFAULT_MAP_DEFINITION.spaces.slice(1).map((space, index) => {
      const previous = DEFAULT_MAP_DEFINITION.spaces[index]
      return Math.hypot(space.x - previous.x, space.y - previous.y)
    })
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(48)
    expect(Math.max(...distances)).toBeLessThanOrEqual(85)
  })

  it('treats the yellow dog landmark as an event space', () => {
    const yellowDogSpace = DEFAULT_MAP_DEFINITION.spaces.find((space) => space.landmarkId === 'yellow-dog')
    expect(yellowDogSpace).toMatchObject({ index: 42, kind: 'event' })
    expect(EVENTS.some((event) => event.id === 'echo')).toBe(true)
  })

  it('separates generic events from every themed landmark pool', () => {
    const genericIds = new Set(GENERIC_EVENT_POOL_IDS)
    const themedIds = new Set(Object.values(LANDMARK_EVENT_POOL_IDS).flat())
    expect(GENERIC_EVENT_POOL_IDS.length).toBeGreaterThanOrEqual(3)
    expect([...genericIds].every((eventId) => !themedIds.has(eventId))).toBe(true)

    const eventLandmarkIds = DEFAULT_MAP_DEFINITION.spaces
      .filter((space) => space.kind === 'event' && space.landmarkId)
      .map((space) => space.landmarkId!)
    expect(Object.keys(LANDMARK_EVENT_POOL_IDS).sort()).toEqual([...new Set(eventLandmarkIds)].sort())
    expect(Object.values(LANDMARK_EVENT_POOL_IDS).every((poolIds) => new Set(poolIds).size >= 3)).toBe(true)
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
