// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { settlePresentation } from './presentation-recovery'

describe('presentation recovery', () => {
  afterEach(() => vi.useRealTimers())

  it('interrupts a stalled animation at the configured timeout', async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn()
    const outcome = settlePresentation(new Promise<void>(() => undefined), {
      timeoutMs: 12_000,
      subscribeInterrupt: () => unsubscribe,
    })

    await vi.advanceTimersByTimeAsync(12_000)

    await expect(outcome).resolves.toBe('interrupted')
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('reports failed playback without waiting for the timeout', async () => {
    vi.useFakeTimers()
    await expect(settlePresentation(Promise.reject(new Error('animation failed')), {
      timeoutMs: 12_000,
      subscribeInterrupt: () => () => undefined,
    })).resolves.toBe('failed')
    expect(vi.getTimerCount()).toBe(0)
  })
})
