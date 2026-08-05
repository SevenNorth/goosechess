import { describe, expect, it } from 'vitest'
import { effectForType, eventFromUnknown } from './event-model'

describe('next landmark event editor effect', () => {
  it('creates and restores the parameter-free effect', () => {
    expect(effectForType('move-to-next-landmark')).toEqual({ type: 'move-to-next-landmark' })
    expect(eventFromUnknown({
      id: 'next-landmark',
      title: '下一站',
      flavor: '前往下一个地点。',
      kind: '常规事件',
      accent: 'teal',
      aiValue: 5,
      effect: [{ type: 'move-to-next-landmark' }],
      successText: '已抵达。',
    }).effect).toEqual([{ type: 'move-to-next-landmark' }])
  })
})
