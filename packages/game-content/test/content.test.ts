import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTENT_MANIFEST,
  DEFAULT_MAP_CONTENT,
  EVENTS,
  ITEMS,
  LANDMARK_DEFINITIONS,
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
  })

  it('records the three winning spaces separately from the noise house landmark', () => {
    expect(DEFAULT_MAP_CONTENT.winningSpaceIds).toEqual([63, 64, 65])
    expect(LANDMARK_DEFINITIONS.find((landmark) => landmark.id === 'noise-house')?.spaceIds).toEqual([63, 64, 65])
  })
})
