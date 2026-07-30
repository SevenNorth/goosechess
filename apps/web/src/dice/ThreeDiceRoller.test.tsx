// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreeDiceRoller, type ThreeDiceRollerHandle } from './ThreeDiceRoller'

describe('ThreeDiceRoller result presentation', () => {
  afterEach(cleanup)

  it('shows the modifier breakdown centrally and the actual movement in the corner', async () => {
    const ref = createRef<ThreeDiceRollerHandle>()
    const view = render(<ThreeDiceRoller ref={ref} canRoll={false} stage="rolling" onRoll={() => undefined} />)
    await act(() => ref.current!.roll({
      type: 'dice-roll',
      cueId: 'cue-1',
      sequence: 1,
      playerId: 'local-player',
      rawDice: [2, 5],
      dice: [2, 5],
      movementTotal: 10,
      movementModifier: 3,
      adjustments: [],
    }, 1))

    expect(screen.getByRole('status', { name: '骰子结果 10' }).textContent).toBe('7+3')

    view.rerender(<ThreeDiceRoller ref={ref} canRoll={false} stage="routePreview" onRoll={() => undefined} />)
    expect(screen.getByRole('status', { name: '骰子结果 10' }).textContent).toBe('10')
    expect(screen.getByRole('status').classList.contains('is-corner')).toBe(true)
  })
})
