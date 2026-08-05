import { describe, expect, it } from 'vitest'
import { eventPoolOptions } from './event-pools'
import type { ContentDraft } from './types'

function mapDraft(content: unknown): ContentDraft {
  return {
    id: 'draft-map', contentKey: 'map:test-map', kind: 'map', title: '测试地图', status: 'draft',
    currentRevision: 1, content, contentHash: 'hash', validation: { valid: true, issues: [] },
    createdBy: 'editor', createdAt: 1, updatedAt: 1,
  }
}

describe('event pool options', () => {
  it('combines the general pool, default landmarks and map draft landmarks', () => {
    const options = eventPoolOptions([mapDraft({ landmarks: [{ id: 'lighthouse', name: '灯塔' }] })])
    expect(options).toContainEqual(expect.objectContaining({ id: 'general', label: '通用事件池' }))
    expect(options).toContainEqual(expect.objectContaining({ id: 'snack-stand', label: '小吃摊' }))
    expect(options).toContainEqual(expect.objectContaining({ id: 'lighthouse', label: '灯塔', source: 'map-draft' }))
  })

  it('preserves unknown selections from an existing event draft', () => {
    expect(eventPoolOptions([], ['legacy-pool'])).toContainEqual({
      id: 'legacy-pool', label: 'legacy-pool', source: 'existing-draft',
    })
  })
})
