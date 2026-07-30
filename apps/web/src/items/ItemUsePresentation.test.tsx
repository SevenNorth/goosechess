// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PackageOpen } from 'lucide-react'
import { afterEach, expect, it, vi } from 'vitest'
import { ItemUsePresentation } from './ItemUsePresentation'

afterEach(cleanup)

it('flies another player item from above and completes after the vertical tear', () => {
  const onComplete = vi.fn()
  render(<ItemUsePresentation
    presentation={{
      id: 1,
      playerName: '电脑 1',
      playerColor: '#3977c5',
      itemTitle: '漂流木盾',
      itemMode: '被动',
      description: '自动抵消下一次被撞回效果。',
      source: 'remote',
      durationMs: 2_100,
      Icon: PackageOpen,
    }}
    onComplete={onComplete}
  />)

  const presentation = screen.getByRole('status', { name: '电脑 1使用漂流木盾' })
  const flight = presentation.querySelector('.item-use-flight')!
  expect(flight.classList.contains('is-remote')).toBe(true)
  expect(presentation.textContent).toContain('使用了被动道具')
  expect(presentation.querySelectorAll('.item-use-card-half')).toHaveLength(2)
  fireEvent.animationEnd(flight)
  expect(onComplete).toHaveBeenCalledOnce()
})
