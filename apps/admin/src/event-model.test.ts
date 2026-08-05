import { describe, expect, it } from 'vitest'
import { DEFAULT_EVENT, eventFromUnknown, simulateCheck } from './event-model'

describe('event editor model', () => {
  it('normalizes persisted dice-check events into editable structured effects', () => {
    expect(eventFromUnknown({
      id: 'harbor-test',
      title: '港口检定',
      flavor: '掷骰决定结果。',
      kind: '骰子检定',
      threshold: 8,
      success: [{ type: 'gain-item' }],
      failure: [{ type: 'skip', turns: 2 }],
      successText: '成功',
      failureText: '失败',
      accent: 'gold',
      aiValue: 6,
    })).toMatchObject({
      id: 'harbor-test',
      kind: '骰子检定',
      threshold: 8,
      success: [{ type: 'gain-item' }],
      failure: [{ type: 'skip', turns: 2 }],
      poolIds: ['general'],
    })
  })

  it('uses a deterministic preview sequence without mutating the default template', () => {
    const first = simulateCheck(20260805, 7, 100)
    const second = simulateCheck(20260805, 7, 100)
    expect(first).toEqual(second)
    expect(first.dice).toHaveLength(2)
    expect(first.rate).toBeGreaterThanOrEqual(0)
    expect(first.rate).toBeLessThanOrEqual(1)
    expect(DEFAULT_EVENT.id).toBe('')
  })
})
