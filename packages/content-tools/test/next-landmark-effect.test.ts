import { describe, expect, it } from 'vitest'
import { validateManagedContent } from '../src/index.js'

describe('next landmark managed effect', () => {
  it('accepts the structured parameter-free effect', () => {
    expect(validateManagedContent('event', {
      id: 'next-landmark',
      title: '下一站',
      flavor: '沿路线前往下一个地点。',
      kind: '常规事件',
      accent: 'teal',
      aiValue: 5,
      weight: 1,
      poolIds: ['general'],
      effect: [{ type: 'move-to-next-landmark' }],
      successText: '抵达下一个地点。',
    })).toEqual({ valid: true, issues: [] })
  })
})
