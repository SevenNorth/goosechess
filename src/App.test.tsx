// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'

describe('鹅了个棋', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function startGame() {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /选择/ })[0])
  }

  async function advanceGame(milliseconds: number) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 200) {
      await vi.advanceTimersByTimeAsync(Math.min(200, milliseconds - elapsed))
    }
  }

  it('选择道具后可以掷双骰并移动', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    startGame()

    fireEvent.click(screen.getByRole('button', { name: /掷骰子/ }))
    await advanceGame(550)

    expect(screen.getByText('4 / 65')).toBeTruthy()
    expect(screen.getByText(/你掷出 4 点/)).toBeTruthy()
  })

  it('落在事件格后出现三张事件牌', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.34)
    startGame()

    fireEvent.click(screen.getByRole('button', { name: /掷骰子/ }))
    await advanceGame(2000)

    expect(screen.getByText('从三张牌中选择')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /选择事件/ })).toHaveLength(3)
  })

  it('电脑使用道具后只执行一次掷骰行动', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    startGame()

    fireEvent.click(screen.getByRole('button', { name: /掷骰子/ }))
    await advanceGame(5000)

    expect(screen.getAllByText(/\/ 65/).map((node) => node.textContent)).toEqual(['4 / 65', '7 / 65'])
    expect(screen.getByText('你的回合')).toBeTruthy()
    await advanceGame(3000)
    expect(screen.getAllByText(/\/ 65/).map((node) => node.textContent)).toEqual(['4 / 65', '7 / 65'])
  })
})
