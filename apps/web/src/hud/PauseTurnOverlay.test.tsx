// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { PauseTurnOverlay } from './PauseTurnOverlay'

afterEach(cleanup)

it('keeps the player name visible while changing the central pause message', () => {
  const presentation = { id: 1, previousTurns: 1, remainingTurns: 0, durationMs: 1_800 }
  const view = render(<PauseTurnOverlay
    playerName="电脑 1"
    playerColor="#3977c5"
    turns={1}
    presentation={presentation}
  />)

  const stage = view.container.querySelector<HTMLElement>('.pause-turn-stage')!
  expect(stage.textContent).toContain('电脑 1')
  expect(stage.textContent).toContain('暂停本回合')
  expect(stage.style.getPropertyValue('--pause-presentation-duration')).toBe('1800ms')
  expect(stage.style.getPropertyValue('--pause-spin-duration')).toBe('1260ms')

  view.rerender(<PauseTurnOverlay
    playerName="电脑 1"
    playerColor="#3977c5"
    turns={0}
    presentation={presentation}
  />)
  expect(stage.textContent).toContain('电脑 1')
  expect(stage.textContent).toContain('剩余 0 回合')
  expect(stage.querySelector('.pause-turn-message')?.classList.contains('is-decremented')).toBe(true)
})
