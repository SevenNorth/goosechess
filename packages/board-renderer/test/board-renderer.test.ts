import { describe, expect, it } from 'vitest'
import type { MapDefinition } from '@goose-chess/game-core'
import { mapMarkers, smoothRouteSegments } from '../src/index.js'

const legacyMap = {
  id: 'legacy',
  name: 'Legacy',
  logicalSize: { width: 400, height: 300 },
  spaces: [
    { index: 0, x: 20, y: 30, rotation: 0, kind: 'start' },
    { index: 1, x: 120, y: 30, rotation: 0, kind: 'normal' },
  ],
  winningSpaceIds: [1],
  landmarks: [{ id: 'shop', name: 'Shop', spaceIds: [1], size: 216 }],
  assets: { background: 'paper.png', landmarkAtlas: '', landmarks: { shop: 'shop.png' } },
} satisfies MapDefinition

describe('board renderer geometry', () => {
  it('normalizes legacy landmarks at the rendering boundary', () => {
    expect(mapMarkers(legacyMap)).toEqual([expect.objectContaining({
      id: 'shop',
      asset: 'shop.png',
      transform: expect.objectContaining({ x: 120, y: -15, scale: 2, opacity: 1 }),
    })])
  })

  it('keeps authored marker transform and opacity unchanged', () => {
    const marker = {
      id: 'fog', kind: 'decoration' as const, name: 'Fog', spaceIds: [], asset: 'fog.png',
      transform: { x: 80, y: 90, scale: 1.5, rotation: 12, opacity: 0.35 },
    }
    expect(mapMarkers({ ...legacyMap, markers: [marker] })).toEqual([marker])
  })

  it('creates stable bezier segments through every route point', () => {
    const segments = smoothRouteSegments([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({
      from: { x: 0, y: 0 },
      control1: { x: 12, y: 0 },
      control2: { x: 88, y: -12 },
      to: { x: 100, y: 0 },
    })
    expect(segments[1].to).toEqual({ x: 100, y: 100 })
  })
})
