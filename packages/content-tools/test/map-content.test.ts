import { DEFAULT_MAP_DEFINITION } from '@goose-chess/game-content'
import { describe, expect, it } from 'vitest'
import { compileManagedContent, validateManagedContent } from '../src/index'

describe('managed map content', () => {
  it('accepts the production map shape and compiles a stable content id', () => {
    const content = structuredClone(DEFAULT_MAP_DEFINITION)
    expect(validateManagedContent('map', content)).toEqual({ valid: true, issues: [] })
    expect(compileManagedContent('map', content)).toMatchObject({
      kind: 'map',
      contentId: DEFAULT_MAP_DEFINITION.id,
    })
  })

  it('reports inconsistent landmark assignments before review', () => {
    const content = structuredClone(DEFAULT_MAP_DEFINITION)
    content.spaces[0].landmarkId = 'missing-landmark'
    const result = validateManagedContent('map', content)
    expect(result.valid).toBe(false)
    expect(result.issues.some((issue) => issue.code === 'invalid_map')).toBe(true)
  })
})
