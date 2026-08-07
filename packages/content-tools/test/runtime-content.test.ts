import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { composeRuntimeContentBundle, type RuntimeContentRelease } from '../src/runtime-content.js'

describe('runtime content bundle', () => {
  it('overlays released content and updates semantic pool membership', () => {
    const original = DEFAULT_GAME_DEFINITION.events[0]
    const release: RuntimeContentRelease = {
      version: 'event-v2',
      kind: 'event',
      contentKey: `event:${original.id}`,
      contentHash: 'a'.repeat(64),
      content: { ...original, title: '新版事件', poolIds: ['general'] },
    }
    const bundle = composeRuntimeContentBundle('content-v2', [release])
    const entry = bundle.definitions.find((candidate) => candidate.mapId === DEFAULT_GAME_DEFINITION.map.id)!

    expect(entry.definition.contentVersion).toBe('content-v2')
    expect(entry.definition.events.find((event) => event.id === original.id)?.title).toBe('新版事件')
    expect(entry.definition.map.eventPools?.find((pool) => pool.id === 'general')?.eventIds).toContain(original.id)
    expect(entry.definition.ruleset.version).not.toBe(DEFAULT_GAME_DEFINITION.ruleset.version)
    expect(bundle.releaseVersions).toEqual(['event-v2'])
  })

  it('includes a released map as a selectable immutable map version', () => {
    const map = { ...structuredClone(DEFAULT_GAME_DEFINITION.map), id: 'published-harbor', name: '发布港口' }
    const release: RuntimeContentRelease = {
      version: 'map-v3',
      kind: 'map',
      contentKey: 'map:published-harbor',
      contentHash: 'b'.repeat(64),
      content: map,
    }
    const bundle = composeRuntimeContentBundle('content-map-v3', [release])
    expect(bundle.definitions.map((entry) => entry.mapId)).toEqual([
      DEFAULT_GAME_DEFINITION.map.id,
      'published-harbor',
    ])
    expect(bundle.definitions.find((entry) => entry.mapId === 'published-harbor')).toMatchObject({
      mapVersion: 'map-v3',
      definition: { map: { name: '发布港口' } },
    })
  })

  it('publishes only runtime skin fields and omits production metadata', () => {
    const skin = {
      ...DEFAULT_GAME_DEFINITION.skins[0],
      id: 'published-skin',
      atlas: '/content-assets/runtime.png',
      production: {
        source: '/content-assets/source.png',
        thumbnail: '/content-assets/thumbnail.png',
        shadow: '/content-assets/shadow.png',
      },
    }
    const release: RuntimeContentRelease = {
      version: 'skin-v1',
      kind: 'skin',
      contentKey: 'skin:published-skin',
      contentHash: 'c'.repeat(64),
      content: skin,
    }
    const bundle = composeRuntimeContentBundle('content-skin-v1', [release])
    const published = bundle.definitions[0].definition.skins.find((entry) => entry.id === skin.id)
    expect(published).toMatchObject({ id: skin.id, atlas: skin.atlas })
    expect(published).not.toHaveProperty('production')
  })
})
