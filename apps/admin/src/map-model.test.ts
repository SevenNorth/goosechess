import { describe, expect, it } from 'vitest'
import { createDefaultMap, csvValues, integerCsvValues, localMapIssues, simulateMapPath } from './map-model'

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

  it('uses the authoritative bounce path calculation', () => {
    const map = createDefaultMap()
    expect(simulateMapPath(map, 64, 3)).toMatchObject({
      path: [65, 64, 63],
      toSpaceId: 63,
      bounced: true,
    })
  })
})
