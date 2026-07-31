// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PauseTurnIndicator } from './PauseTurnIndicator'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('rotates the hourglass before decrementing the skipped turn count', () => {
  vi.useFakeTimers()
  const onCountChange = vi.fn()
  const onComplete = vi.fn()
  render(<PauseTurnIndicator
    playerName="电脑 1"
    turns={1}
    presentation={{ id: 1, previousTurns: 1, remainingTurns: 0, durationMs: 1_000 }}
    onCountChange={onCountChange}
    onComplete={onComplete}
  />)

  const indicator = screen.getByRole('status', { name: '电脑 1暂停 1 回合，正在跳过本回合' })
  expect(indicator.classList.contains('is-consuming')).toBe(true)
  expect(indicator.textContent).toBe('暂停1回合')

  act(() => vi.advanceTimersByTime(699))
  expect(onCountChange).not.toHaveBeenCalled()
  expect(onComplete).not.toHaveBeenCalled()

  act(() => vi.advanceTimersByTime(1))
  expect(screen.getByRole('status', { name: '电脑 1暂停 0 回合，正在跳过本回合' }).textContent).toBe('暂停0回合')
  expect(onCountChange).toHaveBeenCalledWith(0)

  act(() => vi.advanceTimersByTime(300))
  expect(onComplete).toHaveBeenCalledOnce()
})

it('renders a persistent counter without a live status outside skip playback', () => {
  const { container } = render(<PauseTurnIndicator playerName="玩家" turns={2} />)
  expect(container.querySelector('[aria-label="玩家暂停 2 回合"]')?.textContent).toBe('暂停2回合')
  expect(screen.queryByRole('status')).toBeNull()
})
