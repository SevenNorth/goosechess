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
  it('combines versioned default and map draft event pools', () => {
    const options = eventPoolOptions([mapDraft({ eventPools: [{ id: 'mystery', name: '神秘' }] })])
    expect(options).toContainEqual(expect.objectContaining({ id: 'general', label: '通用事件池' }))
    expect(options).toContainEqual(expect.objectContaining({ id: 'aup-food', label: '餐饮' }))
    expect(options).toContainEqual(expect.objectContaining({ id: 'mystery', label: '神秘', source: 'map-draft' }))
  })

  it('preserves unknown selections from an existing event draft', () => {
    expect(eventPoolOptions([], ['legacy-pool'])).toContainEqual({
      id: 'legacy-pool', label: 'legacy-pool', source: 'existing-draft',
    })
  })
})
